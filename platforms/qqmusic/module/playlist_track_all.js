// QQ音乐歌单所有歌曲
module.exports = async (query, request) => {
  const playlistId = parseInt(query.id)

  if (!playlistId) {
    throw new Error('Playlist ID is required')
  }

  const offset = parseInt(query.offset) || 0
  const limit = parseInt(query.limit) || 10000

  const data = {
    disstid: playlistId,
    userinfo: 1,
    tag: 1,
    orderlist: 1,
    song_begin: offset,
    song_num: limit,
    onlysonglist: 0,
    enc_host_uin: ''
  }

  const response = await request('music.srfDissInfo.aiDissInfo', 'uniform_get_Dissinfo', data, {
    uin: query.uin || 0,
    qm_keyst: query.qm_keyst || ''
  })

  if (!response.body || response.status !== 200) {
    throw new Error('Playlist detail request failed')
  }

  const playlistData = response.body

  if (!playlistData) {
    throw new Error('Playlist not found')
  }

  return formatPlaylistDetail(playlistData)
}

/**
 * 格式化歌单详情（核心字段）
 */
function formatPlaylistDetail(data) {
  const songlist = data.songlist || []

  return {
    songs: songlist.map(song => ({
      id: song.mid,
      name: song.name || song.title,
      ar: (song.singer || []).map(s => ({ id: s.mid, name: s.name })),
      al: {
        id: song.album ? song.album.id : 0,
        name: song.album ? song.album.name : '',
        picUrl: song.album?.mid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${song.album.mid}.jpg` : ''
      },
      dt: (song.interval || 0) * 1000,
      mv: song.mv ? song.mv.vid : 0,
      fee: song.pay ? song.pay.pay_play : 0,
      alia: [song.subtitle],
      platform: "qqmusic"
    }))
  }
}