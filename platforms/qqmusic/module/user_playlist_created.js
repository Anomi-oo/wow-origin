module.exports = async (query, request) => {
  const data = {
    "uin" : query.uin || ''
  }
  const response = await request("music.musicasset.PlaylistBaseRead", "GetPlaylistByUin", data, {
    uin: query.uin,
    qm_keyst: query.qm_keyst
  })
  return formatUserCreatedPlaylists(response.body.v_playlist)
}

function formatUserCreatedPlaylists (userCreatedPlaylists) {
  return {
    playlist: userCreatedPlaylists.map(playlist => ({
      id: Number(playlist.tid),
      dirId: playlist.dirId,
      name: playlist.dirName,
      coverImgUrl: playlist.picUrl,
      trackCount: Number(playlist.songNum || 0),
      playCount: 0,
      createTime: Number(playlist.createTime || 0),
      updateTime: Number(playlist.updateTime || 0),
      creator: {
        userId: Number(playlist.uin || 0),
        nickname: '',  //无返回值
        avatarUrl: ''
      },
      userId: Number(playlist.uin),
      subscribed: true,
      privacy: 0,
      description: playlist.desc || '',
      tags: playlist.tagNameList || []
    })),
    total: userCreatedPlaylists.length
  }
}