//排行榜
// 榜单列表、巅峰潮流、飙升、热歌...

module.exports = (query, request) => {
  return request("music.musicToplist.Toplist", "GetAll", {}, {
    uin: 0,
    qm_keyst: ''
  }).then(res => {
    return formatToplist (res.body?.group || [])
  })
}


function formatToplist(group) {
  
  return {
    data: group.map(item => ({
      name: item.groupName,
      displayType: 'TOP_3',
      list: (item.toplist || []).map(toplist => ({
        id: toplist.topId,         //不是通用playlist id
        name: toplist.title || '',
        coverImgUrl: toplist.headPicUrl || '',
        updateFrequency: toplist.updateTips || '',
        tracks: (toplist.song || []).map(song => ({
          first: song.name || song.title,
          second: song.singerName
        })),
        targetType: toplist.recType==10005 ? 'PLAYLIST' : '',
        platform: "qqmusic"
      }))
    }))
  }
}