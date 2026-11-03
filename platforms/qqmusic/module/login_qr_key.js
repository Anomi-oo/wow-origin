const { startLogin } = require('../util/qq-login')

module.exports = async (query, request) => {
  const { qrcode, token } = await startLogin(query.qq_android_identity, query.qrType)
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
