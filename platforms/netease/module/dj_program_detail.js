// 电台节目详情

module.exports = (query, request) => {
  const data = {
    id: query.id,
  }
  return request(`/api/dj/program/detail`, data, {
    crypto: 'weapi',
    useCheckToken: false,
    MUSIC_U: query.MUSIC_U || ''
  }).then (res => {
    return res.body
  })
}
