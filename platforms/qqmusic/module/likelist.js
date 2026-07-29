const getUserPlaylist = require('./user_playlist')
const getPlaylistDetail = require('./playlist_detail')

module.exports = async (query, request) => {
  const userPlaylist = await getUserPlaylist(query, request)
  const favoritePlaylist = (userPlaylist.playlist || []).find((playlist) => playlist.name === '我喜欢')

  if (!favoritePlaylist) {
    throw new Error('Favorite playlist not found')
  }

  const playlistDetail = await getPlaylistDetail({
    id: favoritePlaylist.id,
    limit: 1000,
    offset: 0,
    uin: query.uin,
    qm_keyst: query.qm_keyst
  }, request)

  const playlist = playlistDetail.playlist || playlistDetail
  const tracks = playlist.tracks || []

  return {
    ids: tracks.map((track) => Number(track.id)),
    playlist,
    tracks
  }
}

// 旧实现保留作注释，后续需要时可回退或参考。
/*
module.exports = async (query, request) => {
  const data = {
    "uin": query.uin || ''
  }
  // console.log('Response:', JSON.stringify(response, null, 2))
  
  // 提取所有歌单的ID
  const ids = response.body.v_list.map(playlist => Number(playlist.tid))
  
  return {
    ids: ids
  }
}
*/
