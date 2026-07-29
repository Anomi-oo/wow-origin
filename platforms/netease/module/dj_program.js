// 电台节目列表
const toBoolean = (val) => typeof val === 'boolean' || val === '' ? val : val === 'true' || val == '1'

module.exports = (query, request) => {
  const data = {
    radioId: query.rid,
    limit: query.limit || 30,
    offset: query.offset || 0,
    asc: toBoolean(query.asc),
  }
  return request(`/api/dj/program/byradio`, data, {
    crypto: 'weapi',
    useCheckToken: false,
    MUSIC_U: query.MUSIC_U || ''
  }).then (res => {
    return res.body
  })
}
