module.exports = async (query, request) => {
  const offset = Number.parseInt(query.offset, 10) || 0
  const limit = Number.parseInt(query.limit, 10) || 20
  const data = {
    "From": offset,
    "Size": limit
  }
  const response = await request("music.playlist.PlaylistSquare", "GetRecommendFeed", data, {
    uin: query.uin || 0,
    qm_keyst: query.qm_keyst || ''
  })
  if (!response || !response.body || !response.body.List) {
    throw new Error('Get recommend playlists request failed')
  }
  return formatRecPlaylists(response.body.List)
}

function formatRecPlaylists (recPlaylists) {
  return {
    result: recPlaylists.map(playlist => ({
      id: Number(playlist.Playlist.basic.tid),
      name: playlist.Playlist.basic.title,
      coverImgUrl: playlist.Playlist.basic.cover.default_url,
      trackCount: Number(playlist.Playlist.basic.song_cnt || 0),
      playCount: Number(playlist.Playlist.basic.play_cnt || 0),
      subCount: Number(playlist.Playlist.basic.fav_cnt || 0),
      createTime: Number(playlist.Playlist.basic.create_time || 0),
      updateTime: Number(playlist.Playlist.basic.modify_time || 0),
      tags: playlist.Playlist.basic.v_tag?.map(tag => tag.name) || [],
      description: playlist.Playlist.basic.desc || '',
      tracks: [],
      creator: {
        userId: Number(playlist.Playlist.basic.creator.uin || 0),
        nickname: playlist.Playlist.basic.creator.nick || '',
        avatarUrl: playlist.Playlist.basic.creator.avatar || ''
      },
      platform: 'qqmusic'
    }))
  }
}
