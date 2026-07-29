
// 网易云音乐歌单所有歌曲
module.exports = (query, request) => {
  const data = {
    id: query.id,
    n: 100000,
    s: query.s || 8,
  }
  //不放在data里面避免请求带上无用的数据
  const limit = parseInt(query.limit) || 1000
  const offset = parseInt(query.offset) || 0

  return request(`/api/v6/playlist/detail`, data, {
    crypto: 'eapi',
    useCheckToken: false,
    MUSIC_U: query.MUSIC_U || ''
  }).then((res) => {
      const trackIds = res.body.playlist.trackIds || []
      const idsData = {
        c:
          '[' +
          trackIds
            .slice(offset, offset + limit)
            .map((item) => '{"id":' + item.id + '}')
            .join(',') +
          ']'
      }

      return request(`/api/v3/song/detail`, idsData, {
        crypto: 'eapi',
        useCheckToken: false,
        MUSIC_U: ''
      })
    }
  ).then(response => {
    return response.body
  })
}
