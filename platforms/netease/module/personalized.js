// 推荐歌单

module.exports = (query, request) => {
  const data = {
    limit: query.limit || 30,
    // offset: query.offset || 0,
    total: true,
    n: 1000,
  }
  return request(`/api/personalized/playlist`, data, {
      crypto: "weapi",
      useCheckToken: false,
      MUSIC_U: query.MUSIC_U || ''
  }).then(res => {
    return res.body
  })
}
