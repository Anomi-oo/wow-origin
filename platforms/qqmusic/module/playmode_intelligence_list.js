//智能播放

module.exports = (query, request) => {
  query.like = query.like == 'false' ? false : true
  const data = {
    "LastToastTime" : Date.now(),
    "NeedNum" : 149,
    "Page" : 1,
    "ReqType" : 0
  }

  return request("music.recommend.TrackRelationServer", "GetRadarSong", data, {
    uin: query.uin || 0,
    qm_keyst: query.qm_keyst || ''
  }).then(res => {
    return formatpersonalFm(res.body.VecSongs)
  })
}

function formatpersonalFm(VecSongs) {
  return {
    data: VecSongs.map(song => ({
      id: song.Track.id,
      mid: song.Track.mid,                
      name: song.Track.name || song.Track.title,
      ar: song.Track.singer ? song.Track.singer.map(s => ({
        id: s.mid,
        name: s.name
      })) : [],
      al: {
        id: song.Track.album ? song.Track.album.id : 0,
        mid: song.Track.album ? song.Track.album.mid : 0,
        name: song.Track.album ? song.Track.album.name : '',
        picUrl: song.Track.album?.mid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${song.Track.album.mid}.jpg` : ''
      },
      dt: (song.Track.interval || 0)*1000,
      mv: song.Track.mv?.vid || 0,
      fee: song.Track.pay ? song.Track.pay.pay_play : 0,
      alia: [song.Track.subtitle || ''],
      platform: "qqmusic",
    }))
  }
}