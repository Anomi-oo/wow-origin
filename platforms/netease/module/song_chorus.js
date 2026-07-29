// 副歌时间

module.exports = (query, request) => {
  return request(`/api/song/chorus`,
    {
      ids: JSON.stringify([query.id]),
    },
    {
      crypto: '',
      useCheckToken: false,
      MUSIC_U: ''
    }).then(res => {
      return res.body
  })
}
