//每日推荐单曲

module.exports = (query, request) => {
  const data = {
    limit: query.limit || 100
  }
  return request("/api/v1/discovery/recommend/songs", data, {
    crypto: "eapi",
    useCheckToken: false,
    MUSIC_U: query.MUSIC_U || ''
  }).then(response => {
    return response.body
  })
}