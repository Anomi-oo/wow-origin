// 网易云 cloudsearch 标准化

module.exports = (query, request) => {
  const limit = parseInt(query.limit) || 30
  const offset = parseInt(query.offset) || 0
  const data = {
    s: query.keywords,
    type: query.type || 1, // 1: 单曲, 10: 专辑, 100: 歌手, 1000: 歌单, 1002: 用户, 1004: MV, 1006: 歌词, 1009: 电台, 1014: 视频
    limit,
    offset,
    total: true,
  }
  return request(`/api/cloudsearch/pc`, data, {
    crypto: 'eapi',
    useCheckToken: false,
    MUSIC_U: ''
  }).then(res => {
    const body = res.body || {}
    const result = body.result || {}
    const songs = Array.isArray(result.songs) ? result.songs : []

    // 仅处理歌曲类型（type=1）的标准化，其它类型沿用原结构
    if ((query.type || 1) == 1) {
      const songCount = Number(result.songCount)
      const hasMore = offset + songs.length < songCount

      return {
        result: {
          songs: songs.map(normalizeSong),
          songCount,
          hasMore
        }
      }
    }

    // 其它类型直接透传，但仍保留顶层 result 结构
    return { result }
  })
}

function toHttps(url) {
  if (typeof url !== 'string') return url
  return url.startsWith('http://') ? url.replace('http://', 'https://') : url
}

function normalizeSong(song) {
  // 强化关键字段与 HTTPS 图片（仅使用 cloudsearch 返回字段，不复用其它接口字段）
  const al = song.al || {}
  return {
    id: Number(song.id),
    name: song.name,
    ar: Array.isArray(song.ar) ? song.ar.map(a => ({ id: Number(a.id), name: a.name, picUrl: a.picUrl, img1v1Url: a.img1v1Url, alias: a.alias })) : [],
    al: { id: Number(al.id || 0), name: al.name || '', picUrl: toHttps(al.picUrl || '') },
    dt: Number(song.dt || 0),
    fee: Number(song.fee || 0),
    mv: Number(song.mv || 0),
    alia: song.alia || [],
    pop: song.pop,
    platform: "netease"
  }
}
