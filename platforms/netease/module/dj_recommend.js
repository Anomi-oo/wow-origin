// 精选电台

module.exports = (query, request) => {
  return request(`/api/djradio/recommend/v1`, {}, {
    crypto: "weapi",
    useCheckToken: false,
    MUSIC_U: query.MUSIC_U || ''
  }).then(res => {
    return res.body
  })
}
