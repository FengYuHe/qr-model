'use strict';
const moment = require('moment');

module.exports = function(Qr) {
  Qr.scanCode = async function (data, options, res) {
    const qrCode = data.code;
    const config = Qr.app.get('wechat');
    const userId = options.accessToken.userId;
    const time = moment().format('YYYYMMDD'); // 20170812
    const qr = await Qr.findOne({where: {secret: qrCode}});
    const account = await Qr.app.models.Account.findById(userId);
    const token = options.accessToken;
    // 当天第一次参加活动
    if (!account.active_date || moment(account.active_date).format('YYYYMMDD') !== time) {
      statistics(8, time, 1); // 记录活跃用户数
    }
    await account.updateAttributes({active_date: new Date()}); // 更新用户活跃时间
    if (!qr) {
      const qrErr = JSON.stringify({code: 404, message: '此二维码不存在'});
      // res.redirect(`${config.pageDomain}index.html#/login?token=${token.id}&qrErr=${qrErr}`);
      return JSON.parse(qrErr);
    } else if (qr.is_used) {
      await qr.updateAttributes({ count: qr.count + 1});
      const qrErr = JSON.stringify({code: 400, message: '此二维码已使用', used_at: qr.used_at});
      // res.redirect(`${config.pageDomain}index.html#/login?token=${token.id}&qrErr=${qrErr}`);
      return JSON.parse(qrErr);
    } else {
      await qr.updateAttributes({is_used: true, used_openid: account.weixin_openid, used_at: new Date(), count: 1});
      const list = [];
      statistics(1, time, 1);// 记录二维码扫码量
      // 二维码奖项处理
      qr.prize.forEach(async item => {
        // 再来一包生成兑奖卡
        if (item.type === 3) {
          const prize = {title: item.name, used_openid: account.weixin_openid, product_id: item.product_id, is_used: false, remark: item.remark};
          // 活动记录
          Qr.app.models.ActivityRecord.create({weixin_openid: account.weixin_openid, is_success: true,
            activity_type: 2, prize_type: 3, prize_product_id: item.product_id, prize_product_name: item.name, prize_product_num: 1});
          list.push(prize);
        } else if (item.type === 1) { // 积分
          // 兼容相加不是数字的情况
          const points = Number(account.weixin_points) + Number(item.num);
          const weixin_points = typeof points === 'number' ? points : account.weixin_points;
          account.updateAttributes({weixin_points});
          // 活动记录
          Qr.app.models.ActivityRecord.create({weixin_openid: account.weixin_openid, is_success: true,
            activity_type: 2, prize_type: 1, prize_point: item.num, prize_product_name: item.name});
          statistics(3, time, item.num);// 记录二维码积分赠送量
        }
      });
      const redeem = await Qr.app.models.Redeem.create(list);
      for (let i = 0; i < qr.prize.length; i++) {
        if (qr.prize[i].type === 3) {
          qr.prize[i].id = redeem[0].id;
        }
      }
      const qrPrize = JSON.stringify(qr.prize);
      return JSON.parse(qrPrize);
      // res.redirect(`${config.pageDomain}index.html#/login?token=${token.id}&qrInfo=${qrPrize}`);
    }
  };

  Qr.remoteMethod('scanCode', {
    description: '扫码抽奖',
    accepts: [
      {arg: 'data', type: 'object', required: true, description: '二维码串', http: {source: 'body'}},
      {arg: 'options', type: 'object', http: 'optionsFromRequest'},
      {arg: 'res', type: 'object', http: {source: 'res'}}
    ],
    returns: {arg: 'result', type: 'object'},
    http: {verb: 'POST', path: '/code'},
  });

  /**
   * 记录统计数据
   * @param type {Number} 类型
   * @param time {String} 时间，20180912
   * @param num {Number} 数量
   * @returns {Promise.<void>}
   */
  async function statistics(type, time, num) {
    const statistics = await Qr.app.models.Statistics.findOne({where: {time, type}});
    let qrPointCount = (statistics && Number(statistics.count)) || 0;
    qrPointCount += Number(num);
    Qr.app.models.Statistics.upsertWithWhere({time, type}, {time, type, count: qrPointCount});
  }
};
