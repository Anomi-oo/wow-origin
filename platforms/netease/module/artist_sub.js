// 收藏与取消收藏歌手

module.exports = (query, request) => {
  query.t = query.t == 1 ? 'sub' : 'unsub'
  const data = {
    artistId: query.id,
    artistIds: '[' + query.id + ']',
  }
  return request(`/api/artist/${query.t}`, data, {
    crypto: "weapi",
    useCheckToken: false,
    MUSIC_U: query.MUSIC_U || ''
  }).then(res => {
    return res.body
  })
}
