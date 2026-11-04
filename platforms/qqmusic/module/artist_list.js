// QQ 上游固定每页 80 位艺人；按上游页边界取数，再截取请求范围。
const PAGE_SIZE = 80

module.exports = async (query, request) => {
  const limit = Math.min(parseInt(query.limit) || 20, 100)
  const offset = parseInt(query.offset) || 0
  const start = Math.floor(offset / PAGE_SIZE) * PAGE_SIZE
  const singers = []
  let total = 0

  for (let sin = start; sin < offset + limit; sin += PAGE_SIZE) {
    const response = await request('Music.SingerListServer', 'get_singer_list', {
      area: Number(query.area ?? -100),
      sex: Number(query.type ?? -100),
      genre: Number(query.genre ?? -100),
      index: Number(query.initial ?? -100),
      sin,
      cur_page: Math.floor(sin / PAGE_SIZE) + 1
    }, { uin: 0, qm_keyst: '', keepEnvelope: true })
    const result = response.body?.req_0
    if (response.body?.code !== 0 || result?.code !== 0 || !Array.isArray(result.data?.singerlist)) {
      throw new Error('QQ Music artist list request failed')
    }
    total = Number(result.data.total) || 0
    singers.push(...result.data.singerlist)
    if (sin + PAGE_SIZE >= total || result.data.singerlist.length < PAGE_SIZE) break
  }

  const artists = singers.slice(offset - start, offset - start + limit).map(formatArtist)
  return { artists, more: offset + artists.length < total, total }
}

/**
 * 格式化歌手数据为统一格式
 * @param {Object} singer - QQ音乐原始歌手数据
 * @returns {Object} 格式化后的歌手数据
 */
function formatArtist(singer) {
  const singerMid = singer.singer_mid || singer.singerMID || ''
  const singerPic = singer.singer_pic || singer.singerPic || ''

  return {
    // 基础信息
    id: singerMid,
    name: singer.singer_name || singer.singerName || '',

    // 图片信息（优先使用API返回的图片，否则根据mid生成）
    picUrl: singerPic || (singerMid ? `https://y.gtimg.cn/music/photo_new/T001R300x300M000${singerMid}.jpg` : ''),
    img1v1Url: singerPic || (singerMid ? `https://y.gtimg.cn/music/photo_new/T001R300x300M000${singerMid}.jpg` : ''),

    // 别名
    alias: [],

    // 统计信息
    albumSize: 0,
    mvSize: 0,

    // 平台标识
    platform: "qqmusic"
  }
}
