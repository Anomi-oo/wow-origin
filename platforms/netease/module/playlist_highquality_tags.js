// 精品歌单 tags

module.exports = (query, request) => {
  const data = {}
  return request(
    `/api/playlist/highquality/tags`,
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
