// 歌手相关MV

module.exports = (query, request) => {
  const data = {
    artistId: query.id,
    limit: query.limit,
    offset: query.offset,
    total: true,
  }
  return request(`/api/artist/mvs`, data, {
    crypto: "weapi",
    useCheckToken: false,
    MUSIC_U: ''
  }).then(res => {
    return res.body
  })
}
