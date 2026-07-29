// 热门歌手

module.exports = (query, request) => {
  const data = {
    limit: query.limit || 50,
    offset: query.offset || 0,
    total: true,
  }
  return request(`/api/artist/top`, data, { 
    crypto: "weapi",
    useCheckToken: false,
    MUSIC_U: ''
  }).then(res => {
    return res.body
  })
}
