// QQ音乐用户歌单（包括创建和收藏的）
const getUserCreatedPlaylists = require('./user_playlist_created')
const getUserLikedPlaylists = require('./user_playlist_liked')

module.exports = async (query, request) => {
  const uin = query.uin || 0
  const qm_keyst = query.qm_keyst || ''

  if (!uin || !qm_keyst) {
    throw new Error('Auth info missing')
  }

  const userCreatedPlaylists = await getUserCreatedPlaylists(query, request)
  const userLikedPlaylists = await getUserLikedPlaylists(query, request)

  return {
    playlist: userCreatedPlaylists.playlist.concat(userLikedPlaylists.playlist),
    total: userCreatedPlaylists.total + userLikedPlaylists.total
  }
}
