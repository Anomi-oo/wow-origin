// 已收藏MV列表

module.exports = (query, request) => {
  const data = {
    limit: query.limit || 25,
    offset: query.offset || 0,
    total: true,
  }
  return request(
    `/api/cloudvideo/allvideo/sublist`,
    data,
    {
      crypto: "weapi",
      useCheckToken: false,
      MUSIC_U: query.MUSIC_U || ''
    }
  ).then(res => {
    return res.body
  })
}
