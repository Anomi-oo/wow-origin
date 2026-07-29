// 喜欢的歌曲(无序)

module.exports = (query, request) => {
  const data = {
    uid: query.uid,
  }
  return request(`/api/song/like/get`, data, {
    crypto: "eapi",
    useCheckToken: false,
    MUSIC_U: query.MUSIC_U || ''
  }).then(res => {
    return res.body
  })
}
