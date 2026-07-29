// 歌单添加或删除歌曲
const getPlaylistCreated = require('./user_playlist_created')

module.exports = async(query, request) => {

  const op =  query.op === "del" ? "DelSonglist" : "AddSonglist"

  const v_songInfo = query.tracks?.split(',').map(id => ({
    "songType": 0,
    "songId": Number(id)
  }))

  const playlistCreated = await getPlaylistCreated(query, request)
  const playlistId = Number(query.pid)
  const dirId = playlistCreated.playlist.find(pl => pl.id === playlistId)?.dirId
  if (!dirId) {
    throw new Error('Playlist not found or not created by user')
  }

  const data = {
    "dirId": dirId,
    "v_songInfo": v_songInfo
  }

  const res = await request("music.musicasset.PlaylistDetailWrite", op, data, {
    uin: query.uin,
    qm_keyst: query.qm_keyst
  })

  if (res.body.retCode !== 0) {
    throw new Error(`Failed to ${op} songs: ${JSON.stringify(res.body)}`)
  }

  return {
    body: {
      code: 200,
      ...res.body
    },
    status: 200
  }
}