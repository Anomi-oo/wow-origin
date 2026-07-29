// QQ音乐新碟上架接口
// 参考文档: QQ音乐新碟接口文档.md

/**
 * QQ音乐新碟上架列表
 *
 * 参数说明:
 * - area: QQ音乐地区参数 (1=内地, 2=港台, 3=欧美, 4=韩国, 5=日本) [必填]
 * - start: 分页起始位置 (等于offset) [必填]
 * - sin: 固定为 0 [必填]
 * - num: 每页数量 (等于limit) [必填]
 * - cat: 网易云兼容参数 (可忽略)
 * - limit: 通用分页参数 (可选,已由num替代)
 * - offset: 通用分页参数 (可选,已由start替代)
 *
 * 返回格式:
 * {
 *   albums: [...],
 *   total: 总数
 * }
 */
module.exports = (query, request) => {
  // ========== 参数处理 ==========

  // 直接使用前端通过 extraParams 传入的 QQ 音乐专属参数
  // 不需要任何映射,前端已经处理好了
  const area = parseInt(query.area) || 1      // 地区 (1-5)
  const start = parseInt(query.start) || 0    // 起始位置
  const sin = 0                                // 固定为 0
  const num = parseInt(query.num) || 20       // 每页数量

  // ========== 构建请求参数 ==========

  const data = {
    area: area,   // QQ音乐地区参数
    start: start, // 分页起始位置
    sin: sin,     // 固定为 0
    num: num      // 每页数量
  }

  // ========== 发送请求 ==========

  return request('newalbum.NewAlbumServer', 'get_new_album_info', data, {
    uin: 0,
    qm_keyst: ''
  }).then(res => {
    // 检查响应数据
    const albumList = res.body?.albums || []
    const total = res.body?.total || 0

    // ========== 格式化返回数据 ==========

    return {
      albums: albumList.map(formatAlbum),
      total: total
    }
  }).catch(error => {
    // 错误处理
    throw new Error(`QQ Music new albums API error: ${error.message || 'Unknown error'}`)
  })
}

/**
 * 格式化专辑数据为统一格式 (与search模块保持一致)
 * @param {Object} album - QQ音乐原始专辑数据
 * @returns {Object} 格式化后的专辑数据
 */
function formatAlbum(album) {
  const albumMid = album.mid || ''
  const picMid = album.photo?.pic_mid || albumMid

  // 获取歌手列表并转换为字符串
  const artist = album.singers && album.singers.length > 0
    ? album.singers.map(s => s.name).join(', ')
    : ''

  // 尝试多个可能的歌曲数量字段
  // 如果接口返回0或undefined，默认为1（一张专辑至少有一首歌）
  const size = album.song_count ||
               album.songnum ||
               album.ex?.track_nums ||
               album.total_song_num || 1

  // 尝试多个可能的公司字段
  const company = album.company?.name ||
                  album.companyshow?.name ||
                  (album.singers && album.singers.length > 0 ? album.singers[0].company?.name : '') ||
                  ''

  return {
    id: album.id,
    mid: albumMid,
    name: album.name || '',
    artist: artist,
    picUrl: picMid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${picMid}.jpg` : '',
    size: size,
    publishTime: album.release_time || '',
    company: company,
    platform: 'qqmusic'
  }
}
