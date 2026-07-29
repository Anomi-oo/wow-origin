// 专辑内容

module.exports = (query, request) => {
  return request(`/api/v1/album/${query.id}`, {}, {
    crypto: "weapi",
    useCheckToken: false,
    MUSIC_U: ''
  }).then(res => {
    return res.body
  })
}
