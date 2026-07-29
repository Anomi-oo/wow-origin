module.exports = async (query, request) => {
  const data = {
    "uin" : query.uin || ''
  }
  const response = await request("music.musicasset.PlaylistFavRead", "GetPlaylistFavInfo", data, {
    uin: query.uin,
    qm_keyst: query.qm_keyst
  })
  return formatUserLikedPlaylists(response.body.v_list)
}

function formatUserLikedPlaylists (userLikedPlaylists) {
  return {
    playlist: userLikedPlaylists.map(playlist => ({
      id: Number(playlist.tid),
      name: playlist.name,
      coverImgUrl: playlist.logo,
      trackCount: Number(playlist.songnum || 0),
      playCount: 0,
      createTime: Number(playlist.createTime || 0),
      updateTime: Number(playlist.updateTime || 0),
      creator: {
        userId: Number(playlist.uin || 0),
        nickname: playlist.nickname || '',
        avatarUrl: ''
      },
      userId: Number(playlist.uin),
      subscribed: true,
      privacy: 0,
      description: playlist.desc || '',
      tags: playlist.tagNameList || []
    })),
    total: userLikedPlaylists.length
  }
}