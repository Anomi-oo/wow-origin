// QQ音乐歌单详情
module.exports = (query, request) => {
  const playlistId = parseInt(query.id)

  if (!playlistId) {
    throw new Error('Playlist ID is required')
  }

  if ( playlistId > 1000) {
    const data = {
      disstid: playlistId,
      userinfo: 1,
      tag: 1,
      orderlist: 1,
      song_begin: parseInt(query.offset) || 0,
      song_num: parseInt(query.limit) || 0,
      onlysonglist: 0,
      enc_host_uin: ''
    }

    return response = request('music.srfDissInfo.aiDissInfo', 'uniform_get_Dissinfo', data, {
      uin: query.uin || 0,
      qm_keyst: query.qm_keyst || ''
    }).then(response => {
        //return response.body
        return formatPlaylistDetail(response.body)
    })
  } 
  // 视为toplist id
  else {
    const getToplistSongs = require('./toplist_songs_v2')
    return getToplistSongs({ topId: playlistId, limit: parseInt(query.limit) || 10000, offset: parseInt(query.offset) || 0 }, request)
  }
}

/**
 * 格式化歌单详情（核心字段）
 */
function formatPlaylistDetail(data) {
  const dirinfo = data.dirinfo
  const songlist = data.songlist || []

  if (!dirinfo) {
    throw new Error('Playlist not found')
  }

  return {
    playlist: {
      id: dirinfo.id,
      name: dirinfo.title,
      description: dirinfo.desc || '',
      coverImgUrl: dirinfo.picurl || '',
      playCount: dirinfo.listennum || 0,
      subCount: dirinfo.ordernum || 0,
      trackCount: dirinfo.songnum || 0,
      creator: {
        userId: dirinfo.host_uin || 0,
        nickname: dirinfo.host_nick || (dirinfo.creator ? dirinfo.creator.nick : ''),
        avatarUrl: dirinfo.headurl || (dirinfo.creator ? dirinfo.creator.headurl : '')
      },
      createTime: (dirinfo.ctime || 0) * 1000,
      tags: dirinfo.tag ? dirinfo.tag.map(tag => tag.name) : [],
      tracks: songlist.map(song => ({
        id: song.id,
        mid: song.mid,
        name: song.name || song.title,
        ar: (song.singer || []).map(s => ({ id: s.mid, name: s.name })),
        al: {
          id: song.album ? song.album.id : 0,
          mid: song.album ? song.album.mid : '',
          name: song.album ? song.album.name : '',
          picUrl: song.album?.mid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${song.album.mid}.jpg` : ''
        },
        dt: (song.interval || 0) * 1000,
        mv: song.mv ? song.mv.vid : 0,
        fee: song.pay ? song.pay.pay_play : 0,
        alia: [song.subtitle],
        platform: 'qqmusic'
      })),
      platform: 'qqmusic'
    }
  }
}
