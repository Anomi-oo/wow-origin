// 收藏/取消收藏专辑

module.exports = (query, request) => {
  query.t = query.t == 1 ? 'sub' : 'unsub'
  const data = {
    id: query.id,
  }
  if(!query.MUSIC_U){
    throw new Error("need MUSIC_U")
  }
  return request(`/api/album/${query.t}`, data, {
    crypto: "weapi",
    useCheckToken: false,
    MUSIC_U: query.MUSIC_U
  }).then(res => {
    return res.body
  })
}
