// 删除歌单

module.exports = async (query, request) => {
  const data = {
    ids: '[' + query.id + ']',
  }
  return request(`/api/playlist/remove`, data, {
      crypto: "weapi",
      useCheckToken: false,
      MUSIC_U: query.MUSIC_U
  }).then(res => {
    return res.body
  })
}