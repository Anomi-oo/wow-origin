// 电台推荐类型

module.exports = (query, request) => {
  return request(`/api/djradio/home/category/recommend`, {}, {
    crypto: 'weapi',
    useCheckToken: false,
    MUSIC_U: 'MUSIC_U' || ''
  }).then (res => {
    return res.body
  })
}
