// QQ音乐焦点MV接口
// 获取焦点推荐的MV列表

const axios = require('axios')

/**
 * QQ音乐焦点MV
 *
 * 参数说明:
 * 无需参数，返回焦点推荐的MV列表
 *
 * 返回格式:
 * {
 *   mvs: [...],
 *   hasMore: false  // 固定推荐列表，不支持分页
 * }
 */
module.exports = async (query, request) => {
  // ========== 构建请求URL ==========
  // 该接口是明文GET请求，不需要加密
  const timestamp = Date.now()
  const url = `https://c6.y.qq.com/mv/fcgi-bin/getmv_by_tag?cmd=pc_mvtuijian&format=json&_=${timestamp}&g_tk_new_20200303=5381&g_tk=5381&uin=0&format=json&inCharset=utf-8&outCharset=utf-8&notice=0&platform=wk_v17&needNewCode=1`

  try {
    // ========== 发送请求 ==========
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://y.qq.com/'
      },
      timeout: 30000
    })

    // 检查响应数据
    const focusList = response.data?.data?.focus?.list || []

    // ========== 格式化返回数据 ==========
    // 注意：焦点MV是固定推荐列表，不支持分页
    return {
      mvs: focusList.map(formatMv),
      hasMore: false
    }

  } catch (error) {
    // 错误处理
    throw new Error(`QQ Music focus MV API error: ${error.message || 'Unknown error'}`)
  }
}

/**
 * 格式化MV数据为统一格式 (与search模块的formatMvSearchResult保持一致)
 * @param {Object} mv - QQ音乐原始MV数据
 * @returns {Object} 格式化后的MV数据
 */
function formatMv(mv) {
  // 获取歌手信息
  const artistName = mv.singername || ''
  const artistId = mv.singermid || ''

  // 封面图URL处理
  // 原始picurl使用的是 imgcache.qq.com 域名，已失效
  // 需要替换为 y.qq.com 域名
  let cover = mv.picurl || ''
  if (cover) {
    // 替换域名和协议
    cover = cover.replace('http://imgcache.qq.com', 'https://y.qq.com')
    // 如果还是HTTP，转换为HTTPS
    if (cover.startsWith('http://')) {
      cover = cover.replace('http://', 'https://')
    }
  }

  // 发布时间处理 - 接口返回的是日期字符串(YYYY-MM-DD)
  const publishTime = mv.publictime || ''

  // 注意：focus接口没有duration和playcnt字段，设置为0
  return {
    id: mv.vid || '',                     // MV视频ID
    name: mv.mvtitle || mv.title || '',   // MV标题
    artistName: artistName,               // 歌手名称
    artistId: artistId,                   // 歌手MID
    duration: 0,                          // focus接口无此字段，设为0
    cover: cover,                         // 封面图URL（域名替换为y.qq.com）
    playCount: 0,                         // focus接口无此字段，设为0
    publishTime: publishTime,             // 发布时间
    platform: 'qqmusic'                   // 平台标识
  }
}
