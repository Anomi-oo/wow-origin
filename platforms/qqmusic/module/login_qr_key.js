const { startLogin } = require('../util/qq-login')

module.exports = async (query, request) => {
  const { qrcode, token } = await startLogin()
  if (!qrcode || !token) {
    throw new Error('获取 QQ 音乐登录二维码失败')
  }
  return {
    "body": {
      "code": 200,
      "data": {
        "unikey": token,
        "qrImg": qrcode
      }
    }
  }
}
