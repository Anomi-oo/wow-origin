// 数字专辑详情
module.exports = (query, request) => {
  const data = {
    id: query.id,
  }
  return request(`/api/vipmall/albumproduct/detail`, data, {
    crypto: "weapi",
    useCheckToken: false,
    MUSIC_U: ''
  }).then (res => {
    return res.body
  })
}
