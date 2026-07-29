// 热搜列表

module.exports = (query, request) => {
  const data = {}
  return request(`/api/hotsearchlist/get`, data, {
    crypto: "weapi",
    useCheckToken: false,
    MUSIC_U: ''
  }).then (res => {
    return res.body
  })
}
