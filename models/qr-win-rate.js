'use strict';

module.exports = function(Qrwinrate) {
  // 创建品项
  Qrwinrate.createQrWinRate = async function (data) {
    return Qrwinrate.create(data);
  };

  // 应用到所有批次中
  Qrwinrate.apply = async function (id) {
    const winRate = await Qrwinrate.findById(id);
    const list = await Qrwinrate.app.models.QRbatch.find({where: {status: {inq: [1, 2]}}});
    list.forEach(item => {
      item.updateAttributes({win_rate_id: id, win_rate_name: winRate && winRate.name});
    });
    return {count: list.length};
  };

  Qrwinrate.remoteMethod('createQrWinRate', {
    description: '创建品项',
    accepts: [{arg: 'data', type: 'object', required: true,
      description: '品项数据,子项字段:{"items":[{ "product_id":"string", "name":"string", "type":1, "type_name":"string", "num":50, "rate":10 }]}',
      http: {source: 'body'}}
    ],
    returns: {arg: 'result', type: 'object'},
    http: {verb: 'POST', path: '/'},
  });

  Qrwinrate.remoteMethod('apply', {
    description: '应用到所有批次中',
    accepts: [{arg: 'id', type: 'string', required: true, description: '品项id', http: {source: 'path'}}
    ],
    returns: {arg: 'result', type: 'object'},
    http: {verb: 'POST', path: '/:id/apply'},
  });
};
