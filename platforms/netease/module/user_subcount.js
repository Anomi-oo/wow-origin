// 收藏计数

module.exports = async (query, request) => {
  const response =  await request(`/api/subcount`, {}, {
    crypto: 'weapi',
    useCheckToken: false,
    MUSIC_U: query.MUSIC_U || ''
  })
  return response.body
}
