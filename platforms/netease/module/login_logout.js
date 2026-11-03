// 退出登录，复用当前账号的 MUSIC_U。
module.exports = async (query, request) => {
  if (!query.MUSIC_U) throw new Error('网易云登录凭证不完整')
  return request('/api/logout', {}, { MUSIC_U: query.MUSIC_U, useCheckToken: false, signal: AbortSignal.timeout(20000) })
}
