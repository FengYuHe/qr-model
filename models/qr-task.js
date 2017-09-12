'use strict';
const _ = require('lodash');
const md5 = require('js-md5');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const Promise = require('bluebird');
const moment = require('moment');
const g = require('strong-globalize')();

module.exports = function(Qrtask) {
  const err = new Error();
  err.statusCode = '400';

  Qrtask.createTask = async function (data) {
    // 验证任务中各种批次的编码区间不重复
    if (!data.items || data.items.length === 0) {
      err.message = g.f('请至少添加一个产品');
      throw err;
    }
    for (let i = 0; i < data.items.length; i++) {
      if (data.items[i].count_code > 1000000) {
        err.message = g.f('超过阀值一百万条');
        throw err;
      }
      data.items[i].product_name = data.items[i].product_name.replace(/\//g, '');
    }
    // 判定批次二维码区间
    for (const item of data.items) {
      const batch = await Qrtask.app.models.QRbatch.findOne({
        where: {
          or: [
            {and: [{start_code: {gte: item.start_code}}, {start_code: {lt: item.end_code}}]},
            {and: [{end_code: {gt: item.start_code}}, {end_code: {lte: item.end_code}}]},
            {start_code: {lte: item.start_code}, end_code: {gte: item.end_code}},
            {start_code: {gte: item.start_code}, end_code: {lte: item.end_code}}
          ]
        }
      });
      if (batch) {
        err.message = g.f(`产品列${item.product_name}编码区间已被占用`);
        throw err;
      }
    }

    const time = moment().format('YYYYMMDD'); // 20170812
    data.status = 2;
    const task = await Qrtask.create(data);
    const statistics = await Qrtask.app.models.Statistics.findOne({where: {time, type: 2}});
    let qrCount = (statistics && Number(statistics.count)) || 0;
    task.items.forEach((item) => {
      qrCount += Number(item.count_code);
      Qrtask.app.models.QRbatch.create(_.assign(item, {task_id: task.id, task_name: task.title, product_id: item.product_id, product_name: item.product_name, status: 5}));
    });
    Qrtask.app.models.Statistics.upsertWithWhere({time, type: 2}, {time, type: 2, count: qrCount});
    writeIn(task);
    return task.save();
  };

  Qrtask.updateTask = async function (id, data) {
    let task = await Qrtask.findById(id);
    if (!task) {
      err.message = g.f('制卡任务不存在');
      throw err;
    }
    task = await task.updateAttributes(data);
    Qrtask.app.models.QRbatch.remove({task_id: task.id});
    task.items.forEach((item) => {
      Qrtask.app.models.QRbatch.create(_.assign(item, {task_id: task.id, task_name: task.title, product_id: item.product_id, product_name: item.product_name, status: 5}));
    });
    writeIn(task);
    return task;
  };

  Qrtask.download = function (id, req, res) {
    Qrtask.findById(id).then(task => {
      if (!task) {
        err.message = g.f('制卡任务不存在');
        throw err;
      } else if (task.status === 4) {
        return task;
      } else {
        Qrtask.app.models.QRbatch.find({where: {task_id: task.id}}).then(result => {
          result.forEach(item => {
            item.updateAttributes({status: 1});
          });
        });
        return task;
      }
    }).then(task => {
      return task.updateAttributes({is_download: true, status: 4});
    }).then(task => {
      const dirpath = path.join(__dirname, `../../../server/storage/code/`);
      execSync(`cd ${dirpath} && zip -r ${task.title}-${task.id}.zip ${task.title}-${task.id}`);
      res.setHeader('Content-Type', 'application/zip; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment;filename=${encodeURIComponent(task.title)}-${task.id}.zip`);
      Promise.fromCallback(cb => Qrtask.app.models.Container.download('code', `${task.title}-${task.id}.zip`, req, res, cb));
    });
  };

  Qrtask.remoteMethod('createTask', {
    description: '创建二维码任务',
    accepts: [{arg: 'data', type: 'object', required: true,
      description: '任务数据，items:{"product_name":"string", "product_id":"string", "product_no":"string", "start_code":"Number", "end_code":"Number", "each_count":"Number", "count":"Number"}',
      http: {source: 'body'}}],
    returns: {arg: 'result', type: 'object'},
    http: {verb: 'POST', path: '/'},
  });

  Qrtask.remoteMethod('updateTask', {
    description: '修改二维码任务',
    accepts: [{arg: 'id', type: 'string', required: true, description: '任务id', http: {source: 'path'}},
      {arg: 'data', type: 'object', required: true,
        description: '任务数据，items:{"product_name":"string", "product_id":"string",' +
        '"product_no":"string", "start_code":"Number", "end_code":"Number", "each_count":"Number", "count_code":"Number"}',
        http: {source: 'body'}}],
    returns: {arg: 'result', type: 'object'},
    http: {verb: 'PUT', path: '/:id'},
  });

  Qrtask.remoteMethod('download', {
    description: '下载二维码压缩包',
    accepts: [{arg: 'id', type: 'string', required: true, description: '任务id', http: {source: 'path'}},
      {arg: 'req', type: 'object', http: {source: 'req'}},
      {arg: 'res', type: 'object', http: {source: 'res'}}
    ],
    returns: {arg: 'result', type: 'object'},
    http: {verb: 'get', path: '/:id'},
  });

  function writeIn(data) {
    const host = Qrtask.app.get('codeHost');
    const dirpath = path.join(__dirname, `../../../server/storage/code/${data.title}-${data.id}`);
    if (!fs.existsSync(dirpath)) {
      fs.mkdirSync(dirpath);
    }
    // 删除文件夹下面所有文件
    const files = fs.readdirSync(dirpath);
    files.forEach(item => {
      fs.unlinkSync(dirpath + '/' + item);
    });
    data.items.forEach((item) => {
      if (item.count_code > 1000000) {
        const err = new Error(g.f('超过阀值一百万条'));
        err.statusCode = '400';
        throw err;
      }
      let start_code = Number.isNaN(Number(item.start_code)) ? item.start_code.substring(2) : item.start_code;
      let end_code = Number.isNaN(Number(item.end_code)) ? item.end_code.substring(2) : item.end_code;
      const prefix = Number.isNaN(Number(item.end_code)) ? item.end_code.substring(0, 2) : '';
      // 头加1处理0开头的情况
      start_code = '1' + start_code;
      end_code = '1' + end_code;

      let num = 0;
      if (item.each_count) {
        // 向上取整
        num = Math.ceil(item.count_code/item.each_count);
      }
      const each_count = item.each_count || item.count_code || (end_code - start_code);
      for (let i = 1; i < num; i++) {
        const pathEnd = ((Number(start_code) + Number(each_count) - 1) + '').substring(1); // 处理文件名尾部
        const txt = path.join(dirpath, `/${item.product_name}-${prefix + start_code.substring(1)}-${prefix}${pathEnd}.txt`);
        const stream = fs.createWriteStream(txt);
        for (let j = 0; j < each_count; j++) {
          stream.write(host + md5(prefix + start_code.substring(1)) + '\r\n');
          start_code = (Number(start_code)+ 1).toString();
          if (j === each_count - 1) {
            // 关闭流
            stream.end();
          }
        }
      }
      // 最后一个文件取余数
      const last_each_count = item.count_code%item.each_count === 0 ? item.each_count : item.count_code%item.each_count;
      const last_path_end = ((Number(start_code) + Number(last_each_count) - 1) + '').substring(1); // 处理文件名尾部;
      const txt = path.join(dirpath, `/${item.product_name}-${prefix + start_code.substring(1)}-${prefix}${last_path_end}.txt`);
      const last_stream = fs.createWriteStream(txt);
      for (let j = 0; j < last_each_count; j++) {
        last_stream.write(host + md5(prefix + start_code.substring(1)) + '\r\n');
        start_code = (Number(start_code)+ 1).toString();
        if (j === last_each_count - 1) {
          // 关闭流
          last_stream.end();
        }
      }
    });
  }
};
