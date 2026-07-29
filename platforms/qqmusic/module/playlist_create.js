//创建歌单

module.exports = (query, request) => {

  const data = {
    "dirName": query.name
  }

  return request("music.musicasset.PlaylistBaseWrite", "AddPlaylist", data, {
    uin: query.uin,
    qm_keyst: query.qm_keyst
  }).then (res => {
    const result = res.body?.result || {}
    return {
      id: result.id,
      playlist: {
        id: result.id,
        dirId: result.dirId,
        name: query.name,
        creator: {
          userId: query.uin,
          nickname: ''
        }
      }
    }
  })
}
