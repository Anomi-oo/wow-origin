// MV详情,需要cookie

module.exports = (query, request) => {
  const data = {
    id: query.mvid,
  }
  return request(`/api/v1/mv/detail`, data, {
    crypto: "weapi",      
    useCheckToken: false,
    MUSIC_U: query.MUSIC_U || ''
  }).then(res => {
    return res.body
  })
}
