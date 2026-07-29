// 全部歌单分类

module.exports = (query, request) => {
  return request(`/api/playlist/catalogue`, {}, {
      crypto: "eapi",
      useCheckToken: false,
      MUSIC_U: ''
  }).then(res =>{
    return res.body
  })
}
