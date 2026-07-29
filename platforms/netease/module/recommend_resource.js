// 每日推荐歌单

module.exports = (query, request) => {
  return request(`/api/v1/discovery/recommend/resource`,{},{
    crypto: "weapi",
    useCheckToken: false,
    MUSIC_U: query.MUSIC_U || ''
  }).then(response => {
    return response.body
  })
}
