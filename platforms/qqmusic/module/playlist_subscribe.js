//收藏歌单

module.exports = (query, request) => {
  const method = Number(query.t) === 1 ? 'FavPlaylist' : 'CancelFavPlaylist'

  const data = {
    "uin": query.uin,
    "v_playlistId": String(query.id).split(',').map(Number).filter(num => !isNaN(num))
  }

  return request("music.musicasset.PlaylistFavWrite", method, data, {
    uin: query.uin,
    qm_keyst: query.qm_keyst
  }).then(res => ({
    success: res.body?.retCode === 0 || res.body?.code === 0 || res.code === 200,
    body: res.body
  }))

}
