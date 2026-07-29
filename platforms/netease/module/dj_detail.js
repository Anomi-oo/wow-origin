// 电台详情

module.exports = (query, request) => {
  const data = {
    id: query.rid,
  }
  return request(`/api/djradio/v2/get`, data, {
    crypto: 'weapi',
    useCheckToken: false,
    MUSIC_U: query.MUSIC_U || ''
  }).then (res => {
    return res.body
  })
}
