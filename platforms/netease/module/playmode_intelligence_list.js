// 智能播放

module.exports = (query, request) => {
  const data = {
    songId: query.id,
    type: 'fromPlayOne',
    playlistId: query.pid,
    startMusicId: query.sid || query.id,
    count: query.count || 1,
  }
  return request(`/api/playmode/intelligence/list`, data, {
      crypto: "eapi",
      useCheckToken: false,
      MUSIC_U: query.MUSIC_U || ''
  }).then(res => {
    return res.body
  })  
}
