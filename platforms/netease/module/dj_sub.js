// 订阅与取消电台

module.exports = (query, request) => {
  query.t = query.t == 1 ? 'sub' : 'unsub'
  const data = {
    id: query.rid,
  }
  return request(`/api/djradio/${query.t}`, data, {
    crypto: 'weapi',
    useCheckToken: false,
    MUSIC_U: query.MUSIC_U || ''
  }).then (res => {
    return res.body
  })
}
