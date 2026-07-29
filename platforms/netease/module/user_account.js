
module.exports = (query, request) => {
  const data = {}
  return request(`/api/nuser/account/get`, data, {
      crypto: 'weapi',
      useCheckToken: false,
      MUSIC_U: query.MUSIC_U || ''
  })
}
