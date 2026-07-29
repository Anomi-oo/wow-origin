//排行榜歌曲详情

module.exports = (query, request) => {

  const topId = parseInt(query.topId)

  if (!topId) {
    throw new Error('Top list id is required')
  }

  const limit = parseInt(query.limit) || 100
  const offset = parseInt(query.offset) || 0

  const data = {
    topid: topId,
    offset: offset,
    num: limit,
    period: ""
  }

  return request("musicToplist.ToplistInfoServer", "GetDetail", data, {
    uin: 0,
    qm_keyst: ''
  }).then(res => {
    //return res.body
    return formatToplist (res.body)
  })
}

function formatToplist(toplist) {
  return {
    playlist: {
      id: toplist.data.topId,
      name: toplist.data.title,
      coverImgUrl: toplist.data.mbFrontPicUrl || toplist.data.headPicUrl || '',
      description: (toplist.data.intro || '').replace(/<br>/g, '\n'),
      updateFrequency: toplist.data.updateTips || '',
      updateTime: toplist.data.updateTime || '',
      playCount: toplist.data.listenNum || 0,
      trackCount: toplist.data.totalNum || 0,
      creator: {
        userId: 1,
        nickname: 'QQ音乐'
      },
      tracks: toplist.songInfoList.map(track => ({
        id: track.id,
        mid: track.mid,
        name: track.title || track.name,
        alia: [track.subtitle],
        ar: (track.singer || []).map(s => ({ id: s.mid, name: s.name })),
        al: {
          id: track.album ? track.album.id : 0,
          mid: track.album ? track.album.mid : '',
          name: track.album ? track.album.name : '',
          picUrl: track.album?.mid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${track.album.mid}.jpg` : ''
        },
        dt: Number(track.interval || 0) * 1000,
        fee: track.pay.pay_play || 0,
        mv: track.mv.vid || '',
        platform: "qqmusic",
      })),
      platform: "qqmusic"
    }
  }
} 