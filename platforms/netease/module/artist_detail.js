
module.exports = (query, request) => {
  return request(`/api/artist/head/info/get`,
    {
      id: query.id,
    },
    {
      crypto: "eapi",
      useCheckToken: false,
      MUSIC_U: ''
    }
  ).then (res => {
    return res.body
  })
}
