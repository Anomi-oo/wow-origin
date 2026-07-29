// 电台个性推荐


module.exports = (query, request) => {
  return request(`/api/djradio/personalize/rcmd`,
    {
      limit: query.limit || 6,
    },
    {
      crypto: 'weapi',
      useCheckToken: false,
      MUSIC_U: 'MUSIC_U' || ''
    }
  )
}
