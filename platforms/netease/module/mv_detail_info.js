// MV 点赞转发评论数数据

module.exports = (query, request) => {
  const data = {
    threadid: `R_MV_5_${query.mvid}`,
    composeliked: true,
  }
  return request(
    `/api/comment/commentthread/info`,
    data,
    { 
      crypto: "weapi",
      useCheckToken: false,
      MUSIC_U: ''
    }).then(res => {
      return res.body
    }
  )
}
