// 默认搜索关键词

module.exports = (query, request) => {
  return request(`/api/search/defaultkeyword/get`, {}, {
    crypto: "eapi",
    useCheckToken: false,
    MUSIC_U: query.MUSIC_U || ''
  }).then (res => {
    return res.body
  })
}
