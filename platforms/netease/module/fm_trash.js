// 垃圾桶

module.exports = (query, request) => {
  const data = {
    songId: query.id,
    alg: 'RT',
    time: query.time || 25,
  }
  return request(`/api/radio/trash/add`, data, {
    crypto: "weapi",
    useCheckToken: false,
    MUSIC_U: query.MUSIC_U || ''
  }).then(res => {
    return res.body
  })
}
