// 编辑歌单，更改简介不生效

module.exports = (query, request) => {
  query.desc = query.desc || ''
  query.tags = query.tags || ''
  const data = {
    '/api/playlist/desc/update': `{"id":${query.id},"desc":"${query.desc}"}`,
    '/api/playlist/tags/update': `{"id":${query.id},"tags":"${query.tags}"}`,
    '/api/playlist/update/name': `{"id":${query.id},"name":"${query.name}"}`,
  }
  return request(`/api/batch`, data, {
      crypto: "eapi",
      useCheckToken: false,
      MUSIC_U: query.MUSIC_U
  }).then(res => {
    return res.body
  })
}
