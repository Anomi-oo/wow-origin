// 搜索建议

module.exports = (query, request) => {
  const data = {
    s: query.keywords || '',
  }
  let type = query.type == 'mobile' ? 'keyword' : 'web'
  return request(`/api/search/suggest/` + type, data, {
    crypto: "weapi",
    useCheckToken: false,
    MUSIC_U: ''
  }).then (res => {
    return res.body
  })
}
