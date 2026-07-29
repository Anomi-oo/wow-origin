// 歌曲动态封面

module.exports = (query, request) => {
  const data = {
    songId: query.id,
  }
  return request(`/api/songplay/dynamic-cover`, data, { 
    crypto: "eapi",
    useCheckToken: false,
    MUSIC_U: ''
  }).then(res => {
    return res.body
  })
}
