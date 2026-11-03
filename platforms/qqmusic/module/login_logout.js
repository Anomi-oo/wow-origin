const { loginError } = require('../util/login-http')
const { getAndroidLoginContext } = require('../util/android-login')

// Reference: https://l-1124.github.io/QQMusicApi/reference/modules/login/#modules.login.LoginApi.logout
module.exports = async (query) => {
  const musicid = String(query.musicid || query.uin || '').replace(/^o/, '')
  const musickey = query.musickey || query.qm_keyst
  if (!/^[1-9]\d*$/.test(musicid) || !musickey) throw new Error('QQ 登录凭证不完整')
  const loginType = Number(query.loginType ?? 2)
  const android = getAndroidLoginContext(musicid, query.qq_android_identity)
  const result = await android.androidLoginCgi('music.login.LoginServer', 'Logout', {}, {
    musicid, musickey, loginType,
  })
  if (result.code !== 0) throw loginError(result.code)
  return { body: { code: 200 } }
}
