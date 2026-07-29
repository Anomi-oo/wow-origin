//收藏单曲

module.exports = (query, request) => {
  query.like = query.like == 'false' ? false : true
  const data = {
    "dirId": 201,
    "v_songInfo": [{
      "songType": 0,
      "songId": Number(query.id)
    }]
  }

  return request("music.musicasset.PlaylistDetailWrite", query.like?"AddSonglist":"DelSonglist", data, {
    uin: query.uin,
    qm_keyst: query.qm_keyst
  }).then(res => {
    return res.body
  })
}