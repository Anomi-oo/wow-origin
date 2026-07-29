// 歌曲音质详情

module.exports = (query, request) => {
  const data = {
    songId: query.id,
  }
  return request(`/api/song/music/detail/get`, data, {
    crypto: "eapi",
    useCheckToken: false,
    MUSIC_U: query.MUSIC_U || ''
  }).then(res => {
    return res.body
  })
}
