const { loginFetch, cookieHeader } = require('../util/login-http')
const { hash33 } = require('../util/qq-login')

module.exports = async (query) => {
  const url = new URL('https://c6.y.qq.com/rsc/fcgi-bin/fcg_get_profile_homepage.fcg')
  url.search = new URLSearchParams({
    g_tk: String(hash33(query.qm_keyst, 5381)), format: 'json', inCharset: 'utf-8', outCharset: 'utf-8',
    notice: '0', cid: '205360838', needNewCode: '0', loginUin: query.uin, hostUin: '0', userid: query.uin, reqfrom: '1',
  })
  const response = await loginFetch(url, {
    headers: { Cookie: cookieHeader({ uin: query.uin, qm_keyst: query.qm_keyst }) },
  }, 'QQ Cookie 验证')
  const result = await response.json().catch(() => null)
  if (result?.code !== 0) throw new Error('QQ Cookie 无效或已过期')
  return { body: { nickname: String(result.data?.creator?.nick || '') } }
}
