// 云盘歌曲删除

module.exports = (query, request) => {
  const data = {
    songIds: [query.id],
  }
  return request(`/api/cloud/del`, data, {
    crypto: "weapi",
    useCheckToken: false,
    MUSIC_U: query.MUSIC_U || ''
  }).then(res => {
    return res.body
  })
}
