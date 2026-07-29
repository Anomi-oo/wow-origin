const { refreshQQMusicCookies } = require('../util/qm_refresh_key')

module.exports = async (query, request) => {
  const result = await refreshQQMusicCookies(query)
  if ( !result.ok ) {
    throw new Error('刷新 QQ 音乐登录状态失败')
  }

  return {
    code: 200,
    cookie: result.tokens,
    refreshed: result.refreshed,
    expireTime: Number(result.tokens?.musickeyCreateTime + result.tokens.keyExpiresIn) // MUSICKEY 有效期 3 天
  }
}
