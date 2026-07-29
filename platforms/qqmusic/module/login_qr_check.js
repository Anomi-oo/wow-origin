const { pollLogin } = require('../util/qq_qr_login_2step')

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
      // 登录完成,返回合并后的 cookies
      const allCookies = {
        ...result.musicData,
        ...result.graphCookies,
        ...result.qqComCookies,
        ...result.yqqCookies
      }

      //console.log("allCookies", JSON.stringify(result, null, 2))

      // 筛选核心字段
      const coreFields = [
        'openid',
        'unionid',
        'uin',
        'qm_keyst',
        'musicid',
        'access_token',
        'refresh_token',
        'musickey',
        'refresh_key',
        'expired_at'
      ]

      const filteredCookie = {}
      coreFields.forEach(field => {
        if (allCookies[field] !== undefined) {
          filteredCookie[field] = allCookies[field]
        }
      })

      return {
        body: {
          code: 803,
          message: "授权登录成功"
        },
        cookie: filteredCookie,
        expireTime: (Number(allCookies.musickeyCreateTime) || 0) + 259200 // MUSICKEY 有效期 3 天
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
