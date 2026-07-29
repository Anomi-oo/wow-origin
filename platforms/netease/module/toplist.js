// 网易云音乐排行榜列表
const Logger = require('../../../core/Logger')
const logger = new Logger({ component: 'netease-toplist' })

/**
 * 网易云音乐排行榜列表模块
 *
 * @param {Object} query - 查询参数
 * @param {Function} request - 请求函数
 * @returns {Promise} 格式化后的排行榜列表
 */
module.exports = (query, request) => {
  return request(`/api/toplist/detail`, {}, {
    crypto: "weapi",
    useCheckToken: false,
    MUSIC_U: ''
  }).then(response => {
    if (!response.body || !response.body.list) {
      throw new Error('Invalid toplist response')
    }

    return formatToplistData(response.body.list)
  }).catch(error => {
    logger.error('NetEase toplist failed', {
      error: error.message
    })
    throw error
  })
}

/**
 * 格式化排行榜列表（核心字段）
 */
function formatToplistData(list) {
  logger.debug('Formatting toplist data', {
    count: list.length
  })

  const toplists = list.map(item => ({
    id: item.id,
    name: item.name,
    coverUrl: item.coverImgUrl || '',
    playCount: item.playCount || 0,
    bookCount: item.subscribedCount || 0,
    trackCount: item.trackCount || 0,
    description: item.description || '',
    updateFrequency: item.updateFrequency || '',
    updateTime: Math.floor((item.updateTime || 0) / 1000),  // 转换为秒
    // 歌曲预览列表（转换字段名）
    songList: (item.tracks || []).slice(0, 3).map(track => ({
      songname: track.first || '',
      singername: track.second || ''
    }))
  }))

  return {
    toplists,
    total: toplists.length
  }
}
