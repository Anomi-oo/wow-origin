// 歌曲详情

module.exports = (query, request) => {
  // 歌曲数量不要超过1000
  query.ids = query.ids.split(/\s*,\s*/)
  const data = {
    c: '[' + query.ids.map((id) => '{"id":' + id + '}').join(',') + ']',
  }
  return request(`/api/v3/song/detail`, data, {
    crypto: 'weapi',
    useCheckToken: false,
    MUSIC_U: ''
  }).then((res) => {
    return res.body
  })
}
