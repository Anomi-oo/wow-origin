// 电台分类列表

module.exports = (query, request) => {
  return request(`/api/djradio/category/get`, {},{
    crypto: 'weapi',
    useCheckToken: false,
    MUSIC_U: query.MUSIC_U || ''
  }).then (res => {
    return res.body
  })
}