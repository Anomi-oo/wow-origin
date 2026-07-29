// 红心与取消红心歌曲

module.exports = (query, request) => {
  query.like = query.like == 'false' ? false : true
  const data = {
    alg: 'itembased',
    trackId: query.id,
    like: query.like,
    time: '3',
  }
  return request(`/api/radio/like`, data, {
    crypto: "weapi",
    useCheckToken: false,
    MUSIC_U: query.MUSIC_U || ''
  }).then(res => {
    return res.body   
  })
}
