// 歌手专辑列表

module.exports = (query, request) => {
  const data = {
    limit: query.limit || 30,
    offset: query.offset || 0,
    total: true,
  }
  return request(
    `/api/artist/albums/${query.id}`,
    data,
    {
      crypto: "weapi",
      useCheckToken: false,
      MUSIC_U: ''
    }
  ).then(res => {
    return res.body
  })
}
