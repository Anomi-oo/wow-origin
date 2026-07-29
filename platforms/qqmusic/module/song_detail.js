// QQ音乐歌曲详情
const { getQualityMap } = require('../config')

module.exports = (query, request) => {
  if (query.mid) {
    const data = {
      song_mid: String(query.mid),
      song_type: 0,
      song_id: 0
    }

    return request('music.pf_song_detail_svr', 'get_song_detail_yqq', data, {
      uin: query.uin || 0,
      qm_keyst: query.qm_keyst || ''
    }).then(response => {
      const track = response.body?.track_info || response.body?.data?.track_info
      if (!track) {
        throw new Error('No song data found')
      }
      return formatSongs([track])
    })
  }

  // 支持单个歌曲ID或多个歌曲ID
  const songIds = query.ids ?
    (Array.isArray(query.ids) ? query.ids : query.ids.split(',').map(id => parseInt(id))) :
    [parseInt(query.id)]

  const data = {
    ids: songIds,
    types: songIds.map(() => 0)  // 0表示歌曲类型
  }

  return request('music.trackInfo.UniformRuleCtrl', 'CgiGetTrackInfo', data, {
    uin: query.uin || 0,
    qm_keyst: query.qm_keyst || ''
  }).then(response => {

    const tracks = response.body.tracks || []

    if (tracks.length === 0) {
      throw new Error('No song data found')
    }

    return formatSongs(tracks)
  }).catch(error => {
    throw error
  })
}

function formatSongs(tracks) {
  const qualityMap = getQualityMap();
  return {
    songs: tracks.map(track => {
      const file = track.file || {}
      return {
        id: track.id,
        mid: track.mid,
        name: track.name || track.title,
        ar: track.singer ? track.singer.map(s => ({
          id: s.mid,
          name: s.name
        })) : [],
        al: {
          id: track.album ? track.album.id : 0,
          mid: track.album ? track.album.mid : '',
          name: track.album ? track.album.name : '',
          picUrl: track.album?.mid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${track.album.mid}.jpg` : ''
        },
        dt: (track.interval || 0) * 1000,
        mv: track.mv?.vid || 0,
        fee: track.pay ? track.pay.pay_play : 0,
        alia: [track.subtitle],
        qualities: Object.entries(qualityMap).map(([key, el]) => {
          const sizeField = el.sizeField;
          if (file[sizeField] && file[sizeField] > 0) {
            return {
              key: key,
              label: el.name,
              bitrate: el.bitrate,
              format: el.format,
              size: file[sizeField]
            }
          }
          return null;
        }),
        platform: 'qqmusic'
      }
    }),
    count: tracks.length
  }
}

module.exports.formatSongs = formatSongs
