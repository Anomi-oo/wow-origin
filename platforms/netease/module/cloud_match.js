
module.exports = (query, request) => {
  const data = {
    userId: query.uid,
    songId: query.sid,
    adjustSongId: query.asid,
  }
  return request(
    `/api/cloud/user/song/match`,
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
