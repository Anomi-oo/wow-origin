// QQ音乐MV分类列表接口
// 获取不同地区、类型、排序的MV列表

/**
 * QQ音乐MV分类列表
 *
 * 参数说明:
 * - limit: 每页数量 [必填]
 * - offset: 分页起始位置 [必填]
 * - area: 地区ID (16=内地, 17=港台, 18=欧美, 19=韩国, 20=日本, 15=全部) [必填]
 * - type: 类型ID (7=全部, 8=MV, 9=现场, 10=翻唱, 11=舞蹈, 12=影视, 13=综艺, 14=儿歌) [必填]
 * - order: 排序方式 (0=最热, 1=最新) [必填]
 *
 * 返回格式:
 * {
 *   mvs: [...],
 *   total: 总数
 * }
 */
module.exports = (query, request) => {
  // ========== 参数处理 ==========

  const limit = parseInt(query.limit) || 20
  const offset = parseInt(query.offset) || 0
  const area = parseInt(query.area) || 15      // 地区ID
  const type = parseInt(query.type) || 7       // 类型ID
  const order = parseInt(query.order) || 0     // 排序方式

  // ========== 构建请求参数 ==========

  const data = {
    order: order,        // 排序: 0=最热, 1=最新
    start: offset,       // 起始位置
    size: limit,         // 每页数量
    version_id: type,    // 类型ID
    area_id: area        // 地区ID
  }

  // ========== 发送请求 ==========

  return request('MvService.MvInfoProServer', 'GetAllocMvInfo', data, {
    uin: 0,
    qm_keyst: ''
  }).then(res => {
    // 检查响应数据
    const mvList = res.body?.list || []
    const total = res.body?.total || 0

    // ========== 格式化返回数据 ==========

    return {
      mvs: mvList.map(formatMv),
      total: total
    }
  }).catch(error => {
    // 错误处理
    throw new Error(`QQ Music MV list API error: ${error.message || 'Unknown error'}`)
  })
}

/**
 * 格式化MV数据为统一格式 (与search模块的formatMvSearchResult保持一致)
 * @param {Object} mv - QQ音乐原始MV数据
 * @returns {Object} 格式化后的MV数据
 */
function formatMv(mv) {
  // 获取主要歌手信息
  const mainSinger = mv.singers && mv.singers.length > 0 ? mv.singers[0] : null
  const artistName = mainSinger ? mainSinger.name : ''
  const artistId = mainSinger ? mainSinger.mid : ''

  // 封面图URL处理
  let cover = mv.picurl || ''
  // 如果是HTTP链接，转换为HTTPS
  if (cover && cover.startsWith('http://')) {
    cover = cover.replace('http://', 'https://')
  }

  // 发布时间处理 - 接口返回的是Unix时间戳(秒)，需要转换为日期字符串
  let publishTime = ''
  if (mv.pubdate) {
    const date = new Date(mv.pubdate * 1000)
    publishTime = date.toISOString().split('T')[0] // 格式: YYYY-MM-DD
  }

  return {
    id: mv.vid || '',                           // MV视频ID
    name: mv.title || '',                       // MV标题
    artistName: artistName,                     // 歌手名称
    artistId: artistId,                         // 歌手MID
    duration: Number(mv.duration || 0) * 1000, // 时长(转为毫秒)
    cover: cover,                               // 封面图URL
    playCount: mv.playcnt || 0,                 // 播放次数
    publishTime: publishTime,                   // 发布时间
    platform: 'qqmusic'                         // 平台标识
  }
}
