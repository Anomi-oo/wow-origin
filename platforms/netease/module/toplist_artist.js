// 歌手榜

module.exports = (query, request) => {
  const data = {
    type: query.type || 1,
    limit: 100,
    offset: 0,
    total: true,
  }
  return request(`/api/toplist/artist`, data, {
      crypto: "weapi",
      useCheckToken: false,
      MUSIC_U: ''
    })
}
