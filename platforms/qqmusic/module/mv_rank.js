// QQ音乐MV排行榜接口
// 获取不同地区的MV排行榜数据

/**
 * QQ音乐MV排行榜
 *
 * 参数说明:
 * - area: 地区类型 [必填]
 *   - 0: 总榜
 *   - 1: 内地
 *   - 2: 港台
 *   - 3: 欧美
 *   - 4: 韩国
 *   - 5: 日本
 *
 * 返回格式:
 * {
 *   mvs: [...],
 *   hasMore: false  // 排行榜数据固定数量，不支持分页
 * }
 */
module.exports = (query, request) => {
  // ========== 参数处理 ==========

  const area = parseInt(query.area) || 0  // 地区类型，默认0(总榜)

  // ========== 构建请求参数 ==========

  const data = {
    rank_type: 0,        // 排行榜类型（固定为0）
    area_type: area,     // 地区类型
    required: [
      "vid",
      "name",
      "pubdate",
      "cover_pic",
      "singers",
      "trend"
    ]
  }

  // ========== 发送请求 ==========

  return request('video.VideoRankServer', 'get_video_rank_list', data, {
    uin: 0,
    qm_keyst: ''
  }).then(res => {
    // 检查响应数据
    const rankList = res.body?.rank_list || []

    // ========== 格式化返回数据 ==========
    // 注意：排行榜接口不返回total字段，使用hasMore代替
    // 排行榜数据是固定数量，不支持分页，所以hasMore始终为false

    return {
      mvs: rankList.map(item => formatMv(item)),
      hasMore: false
    }
  }).catch(error => {
    // 错误处理
    throw new Error(`QQ Music MV rank API error: ${error.message || 'Unknown error'}`)
  })
}

/**
 * 格式化MV排行榜数据为统一格式 (与search模块的formatMvSearchResult保持一致)
 * @param {Object} item - QQ音乐原始排行榜数据
 * @returns {Object} 格式化后的MV数据
 */
function formatMv(item) {
  const videoInfo = item.video_info || {}
  const rankData = item.rank_data || {}

  // 获取主要歌手信息
  const mainSinger = videoInfo.singers && videoInfo.singers.length > 0 ? videoInfo.singers[0] : null
  const artistName = mainSinger ? mainSinger.name : ''
  const artistId = mainSinger ? mainSinger.mid : ''

  // 封面图URL处理
  let cover = videoInfo.cover_pic || ''
  // 如果是HTTP链接，转换为HTTPS
  if (cover && cover.startsWith('http://')) {
    cover = cover.replace('http://', 'https://')
  }

  // 发布时间处理 - 接口返回的是Unix时间戳(秒)，需要转换为日期字符串
  let publishTime = ''
  if (videoInfo.pubdate) {
    const date = new Date(videoInfo.pubdate * 1000)
    publishTime = date.toISOString().split('T')[0] // 格式: YYYY-MM-DD
  }

  return {
    id: videoInfo.vid || '',                    // MV视频ID
    name: videoInfo.name || '',                 // MV标题
    artistName: artistName,                     // 歌手名称
    artistId: artistId,                         // 歌手MID
    duration: 0,                                // 排行榜接口无此字段，设为0
    cover: cover,                               // 封面图URL
    playCount: rankData.week_play || 0,        // 使用周播放量
    publishTime: publishTime,                   // 发布时间
    platform: 'qqmusic',                        // 平台标识

    // 排行榜特有字段
    rank: rankData.rank || 0,                   // 排名
    trend: rankData.trend || 0,                 // 排名变化趋势
    isNew: rankData.new_flag === 1              // 是否新上榜
  }
}
