const { loginCgi, credentialCookies, loginError } = require('../util/login-http')
const validateCookie = require('./login_cookie')
const { hash33 } = require('../util/qq-login')

module.exports = async (query) => {
  const musicid = String(query.musicid || query.uin || '').replace(/^o/, '')
  const musickey = query.musickey || query.qm_keyst
  if (!/^[1-9]\d*$/.test(musicid) || !musickey) throw new Error('QQ 登录凭证不完整')
  // Browser cookies usually lack refresh credentials. Validate without attempting OAuth refresh.
  if (!query.refresh_key && !query.refresh_token) {
    await validateCookie({ uin: musicid, qm_keyst: musickey })
    return { refreshed: false }
  }
  const loginType = Number(query.loginType ?? 2)
  if (![0, 1, 2, 6].includes(loginType)) throw new Error('不支持的 QQ 登录凭证类型')
  const shared = {
    openid: query.openid || '', refresh_token: query.refresh_token || '',
    refresh_key: query.refresh_key || '', musickey, loginMode: 2,
  }
  const param = loginType === 1
    ? { ...shared, str_musicid: musicid, unionid: query.unionid || '' }
    : loginType === 2
      ? { ...shared, access_token: query.access_token || '', expired_in: Number(query.expired_at) || 0, musicid: Number(musicid) }
      : {
          ...shared, access_token: query.access_token || '', expired_in: Number(query.expired_at) || 0,
          musicid: Number(musicid), str_musicid: musicid, unionid: query.unionid || '',
        }
  const gTk = hash33(musickey, 5381)
  const result = await loginCgi('music.login.LoginServer', 'Login', param, {
    ct: 24, cv: 4747474, platform: 'yqq.json', chid: '0',
    uin: Number(musicid), g_tk: gTk, g_tk_new_20200303: gTk,
    format: 'json', inCharset: 'utf-8', outCharset: 'utf-8', notice: 0, needNewCode: 1,
    tmeLoginType: loginType,
  })
  if (result.code !== 0) {
    // Some valid sessions cannot refresh yet. Check the old credential before retaining it.
    if (result.code !== 20279) throw loginError(result.code)
    await validateCookie({ uin: musicid, qm_keyst: musickey })
    return { refreshed: false }
  }
  return { cookie: credentialCookies({ loginType, ...result.data }), refreshed: true }
}
