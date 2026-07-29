// QQ音乐热门歌手接口
// 获取热门歌手TOP10

/**
 * QQ音乐热门歌手TOP10
 *
 * 参数说明:
 * 无需参数，返回全部地区、全部分类的热门歌手前10位
 *
 * 返回格式:
 * {
 *   artists: [...],
 *   hasMore: false
 * }
 */
module.exports = (query, request) => {
  // ========== 构建请求参数 ==========
  const data = {
    area: -100,    // 全部地区
    sex: -100,     // 全部性别
    genre: -100,   // 全部流派
    index: -100,   // 热门排序（不按字母）
    sin: 0,        // 起始位置
    cur_page: 1    // 第1页
  }

  // ========== 发送请求 ==========

  return request('Music.SingerListServer', 'get_singer_list', data, {
    uin: 0,
    qm_keyst: ''
  }).then(res => {
    // 检查响应数据
    const singerList = res.body?.singerlist || []

    // ========== 格式化返回数据 ==========
    // 只返回前10位歌手
    const top10 = singerList.slice(0, 10)

    return {
      artists: top10.map(formatArtist),
      hasMore: false  // 固定返回前10位，不支持分页
    }
  }).catch(error => {
    // 错误处理
    throw new Error(`QQ Music top artists API error: ${error.message || 'Unknown error'}`)
  })
}

/**
 * 格式化歌手数据为统一格式
 * @param {Object} singer - QQ音乐原始歌手数据
 * @returns {Object} 格式化后的歌手数据
 */
function formatArtist(singer) {
  // 头像URL处理
  let avatar = singer.singer_pic || ''
  // 如果是HTTP链接，转换为HTTPS
  if (avatar && avatar.startsWith('http://')) {
    avatar = avatar.replace('http://', 'https://')
  }

  return {
    id: singer.singer_mid || '',        // 歌手MID
    name: singer.singer_name || '',     // 歌手名称
    picUrl: avatar,                     // 歌手头像URL
    platform: 'qqmusic'                 // 平台标识
  }
}
