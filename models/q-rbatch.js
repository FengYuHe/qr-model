'use strict';
const moment = require('moment');
const g = require('strong-globalize')();

module.exports = function(Qrbatch) {
  const err = new Error();
  err.statusCode = '400';
  // 终止批次
  Qrbatch.terminate = async function (id) {
    const batch = await Qrbatch.findById(id);
    if (!batch) {
      err.message = g.f('批次不存在');
      throw err;
    }
    return batch.updateAttributes({status: 4});
  };

  // 单个或批量设置品项
  Qrbatch.setWinRate = async function (ids, winRateId) {
    const winRate = await Qrbatch.app.models.QRWinRate.findById(winRateId);
    if (!winRate) {
      err.message = g.f('品项不存在');
      throw err;
    }
    if (typeof ids === 'string') {
      const batch = await Qrbatch.findById(ids);
      if (!batch) {
        err.message = g.f('批次不存在');
        throw err;
      }
      return batch.updateAttributes({win_rate_id: winRate.id, win_rate_name: winRate.name});
    } else if (Array.isArray(ids)) {
      const batches = await Qrbatch.find({where: {id: {inq: ids}}});
      batches.forEach((item) => {
        item.updateAttributes({win_rate_id: winRate.id, win_rate_name: winRate.name});
      });
      return {count: batches.length};
    } else {
      err.message = g.f('ids参数只能是数组或者字符串');
      throw err;
    }
  };

  // 激活批次
  Qrbatch.activation = async function (ids) {
    const time = moment().format('YYYYMMDD'); // 20170812
    const statistics = await Qrbatch.app.models.Statistics.findOne({where: {time, type: 6}});
    let qrCount = (statistics && Number(statistics.count)) || 0;
    if (typeof ids === 'string') {
      const batch = await Qrbatch.findById(ids);
      if (!batch || batch.status !== 2) {
        err.message = g.f('批次不存在或批次状态不在可激活状态');
        throw err;
      }
      if (!batch.win_rate_id) {
        err.message = g.f('批次未设置品项');
        throw err;
      }
      Qrbatch.app.cp.send({type: 'createCode', batch: batch.id, win_rate_id: batch.win_rate_id});
      batch.updateAttributes({status: 7});
      // 统计激活量
      qrCount += Number(batch.count_code);
      Qrbatch.app.models.Statistics.upsertWithWhere({time, type: 6}, {time, type: 6, count: qrCount});
      return {count: 1};
    } else if (Array.isArray(ids)) {
      const batches = await Qrbatch.find({where: {id: {inq: ids}}});
      batches.forEach(async (item) => {
        if (item.win_rate_id && item.status === 2) {
          qrCount += Number(item.count_code);
          Qrbatch.app.cp.send({type: 'createCode', batch: item.id, win_rate_id: item.win_rate_id});
          item.updateAttributes({status: 7});
        }
      });
      Qrbatch.app.models.Statistics.upsertWithWhere({time, type: 6}, {time, type: 6, count: qrCount});
      return {count: batches.length};
    } else {
      err.message = g.f('ids参数只能是数组或者字符串');
      throw err;
    }
  };

  Qrbatch.remoteMethod('terminate', {
    description: '终止批次',
    accepts: [{arg: 'id', type: 'string', required: true, description: '批次id', http: {source: 'path'}}],
    returns: {arg: 'result', type: 'object'},
    http: {verb: 'POST', path: '/:id/terminate'},
  });

  Qrbatch.remoteMethod('setWinRate', {
    description: '批量设置品项',
    accepts: [{arg: 'ids', type: 'any', required: true, description: '批次id,或ids'},
      {arg: 'winRateId', type: 'string', required: true, description: '品项id'}
    ],
    returns: {arg: 'result', type: 'object'},
    http: {verb: 'POST', path: '/setWinRate'},
  });

  Qrbatch.remoteMethod('activation', {
    description: '单个或批量激活批次',
    accepts: [{arg: 'ids', type: 'any', required: true, description: '批次id,或ids'}
    ],
    returns: {arg: 'result', type: 'object'},
    http: {verb: 'POST', path: '/activation'},
  });
};
