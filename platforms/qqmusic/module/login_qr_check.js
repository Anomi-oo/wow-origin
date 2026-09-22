const { pollLogin } = require('../util/qq-login')

module.exports = async (query, request) => {
  const result = await pollLogin(query.key)

  switch (result.status) {
    case 'waiting':
      // 等待扫码
      return {
        body: {
          code: 801,
          message: "请使用手机QQ扫码"
        }
      }
    case 'confirming':
      // 已扫码,等待确认
      return {
        body: {
          code: 802,
          message: "扫描成功,请确认登录"
        }
      }
    case 'done':
      return {
        body: {
          code: 803,
          message: "授权登录成功"
        },
        cookie: result.cookie
      }
    case 'expired':
      // 二维码过期
      return {
        body: {
          code: 800,
          message: "二维码已过期"
        }
      }
    case 'error':
      return {
        body: {
          code: 500,
          message: result.msg || '扫码登录失败'
        }
      }
  }
}
