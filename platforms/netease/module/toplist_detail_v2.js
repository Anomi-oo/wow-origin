// 所有榜单内容摘要v2

module.exports = (query, request) => {
  return request(`/api/toplist/detail/v2`, {}, {
      crypto: "eapi",
      useCheckToken: false,
      MUSIC_U: ''
  }).then (res => {
    return res.body
  })
}
