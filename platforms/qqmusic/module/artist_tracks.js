// 歌手歌曲

module.exports = (query, request) => {
  const order = query.order === "hot" ? 1 : 2 // 1: hot 2: time
  const offset = Number(query.offset) || 0
  const limit = Number(query.limit) || 100
  const data = {
    "singerMid": query.id,
    "begin": offset,
    "num": limit,
    "order": order || 1
  }

  return request("music.musichallSong.SongListInter", "GetSingerSongList", data, {
    uin: 0,
    qm_keyst: ''
  }).then(res => {
    if (!res.body || !res.body.songList) {
      throw new Error("not found songs")
    }
    return {
      songs: res.body.songList.map(formatSongItem),
      more: res.body.totalNum > (offset + limit),
      total: res.body.totalNum
    }
  })
}

function formatSongItem(song) {
  return {
    id: song.songInfo.id,
    mid: song.songInfo.mid,
    name: song.songInfo.name || song.songInfo.title,
    ar: song.songInfo.singer ? song.songInfo.singer.map(s => ({
      id: s.mid,
      name: s.name
    })) : [],
    al: {
      id: song.songInfo.album ? song.songInfo.album.id : 0,
      mid: song.songInfo.album ? song.songInfo.album.mid : '',
      name: song.songInfo.album ? song.songInfo.album.name : '',
      picUrl: song.songInfo.album?.mid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${song.songInfo.album.mid}.jpg` : ''
    },
    dt: (song.songInfo.interval || 0) * 1000,
    mv: song.songInfo.mv?.vid || '',
    fee: song.songInfo.pay ? song.songInfo.pay.pay_play : 0,
    alia: [song.songInfo.subtitle || ''],
    platform: "qqmusic"
  }
}
