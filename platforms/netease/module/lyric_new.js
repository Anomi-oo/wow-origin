// 新版歌词 - 包含逐字歌词（与旧 lyric 接口不同的后端端点与结构）

module.exports = (query, request) => {
  const data = {
    id: query.id,
    cp: false,
    tv: 0,
    lv: 0,
    rv: 0,
    kv: 0,
    yv: 0,
    ytv: 0,
    yrv: 0,
  }
  return request(`/api/song/lyric/v1`, data, {
    crypto: 'eapi',
    useCheckToken: false,
    MUSIC_U: ''
  }).then(res => {
    const b = res.body || {}
    const wrap = (obj) => obj ? { version: obj.version || 0, lyric: obj.lyric || '' } : undefined
    return {
      lrc: wrap(b.lrc) || { version: 0, lyric: '' },
      tlyric: wrap(b.tlyric),
      klyric: wrap(b.klyric),
      romalrc: wrap(b.romalrc),
      yrc: wrap(b.yrc),
      ytlrc: wrap(b.ytlrc)
    }
  })
}
