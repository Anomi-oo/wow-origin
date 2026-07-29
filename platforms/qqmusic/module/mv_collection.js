// QQ音乐MV合集接口
// 获取精选的MV合集列表

/**
 * QQ音乐MV合集
 *
 * 参数说明:
 * 无需参数，返回推荐的MV合集列表
 *
 * 返回格式:
 * {
 *   collections: [
 *     {
 *       id: 合集ID,
 *       title: 合集标题,
 *       subtitle: 合集副标题,
 *       cover: 合集封面,
 *       platform: "qqmusic"
 *     }
 *   ]
 * }
 */
module.exports = (query, request) => {
  // ========== 构建请求参数 ==========
  // 该接口不需要参数
  const data = {}

  // ========== 发送请求 ==========

  return request('video.VideoLogicServer', 'get_video_collection_main', data, {
    uin: 0,
    qm_keyst: ''
  }).then(res => {
    // 检查响应数据
    const collectionList = res.body?.list || []

    // ========== 格式化返回数据 ==========

    return {
      mvs: collectionList.map(formatCollection)
    }
  }).catch(error => {
    // 错误处理
    throw new Error(`QQ Music MV collection API error: ${error.message || 'Unknown error'}`)
  })
}

/**
 * 格式化MV合集数据为统一格式
 * @param {Object} collection - QQ音乐原始MV合集数据
 * @returns {Object} 格式化后的MV合集数据
 */
function formatCollection(collection) {
  // 封面图URL处理
  let cover = collection.picurl || ''
  // 如果是HTTP链接，转换为HTTPS
  if (cover && cover.startsWith('http://')) {
    cover = cover.replace('http://', 'https://')
  }

  return {
    id: collection.cid || 0,           // 合集ID
    title: collection.title || '',     // 合集标题
    subtitle: collection.subtitle || '', // 合集副标题
    cover: cover,                      // 合集封面URL
    platform: 'qqmusic'                // 平台标识
  }
}
