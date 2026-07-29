// MV链接

module.exports = (query, request) => {
  const data = {
    id: query.id,
    r: query.r || 1080,
  }
  return request(`/api/song/enhance/play/mv/url`, data, { 
    crypto: "weapi",
    useCheckToken: false,
    MUSIC_U: query.MUSIC_U || ''
  }).then(res => {
    return res.body
  })
}
