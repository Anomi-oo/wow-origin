// 所有榜单内容摘要

module.exports = (query, request) => {
  return request(`/api/toplist/detail`, {}, {
      crypto: "weapi",
      useCheckToken: false,
      MUSIC_U: ''
  }).then (res => {
    return res.body
  })
}
