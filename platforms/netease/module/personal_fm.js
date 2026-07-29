// 私人FM

module.exports = (query, request) => {
  return request(`/api/v1/radio/get`, {}, {
    crypto: "weapi",
    useCheckToken: true,
    MUSIC_U: query.MUSIC_U || ''
  }).then(res => {
    return res.body
  })
}
