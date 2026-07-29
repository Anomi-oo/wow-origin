// 相似歌曲

module.exports = (query, request) => {
  const data = {
    songid: query.id,
    limit: query.limit || 50,
    offset: query.offset || 0
  }

  return request('/api/v1/discovery/simiSong', data, {
    crypto: 'weapi',
    useCheckToken: false,
    MUSIC_U: query.MUSIC_U || ''
  }).then(response => response.body)
}
