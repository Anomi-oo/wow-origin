// 网易云音乐歌词
const Logger = require('../../../core/Logger')
const logger = new Logger({ component: 'netease-lyric' })

/**
 * 网易云音乐歌词模块
 *
 * @param {Object} query - 查询参数
 * @param {string} query.id - 歌曲ID (必填)
 * @param {Function} request - 请求函数
 * @returns {Promise} 格式化后的歌词
 */
module.exports = (query, request) => {
  const data = {
    id: query.id,
    tv: -1,
    lv: -1,
    rv: -1,
    kv: -1,
    _nmclfl: 1,
  }

  return request(`/api/song/lyric`, data, {
    crypto: "eapi",
    useCheckToken: false,
    MUSIC_U: ''
  }).then(response => {
    if (!response.body) {
      throw new Error('Invalid lyric response')
    }

    return formatLyricData(response.body)
  }).catch(error => {
    logger.error('NetEase lyric failed', {
      error: error.message,
      songId: query.id
    })
    throw error
  })
}

/**
 * 格式化歌词数据（核心字段）
 */
function formatLyricData(data) {
  logger.debug('Formatting lyric data', {
    hasLrc: !!data.lrc,
    hasTlyric: !!data.tlyric,
    hasKlyric: !!data.klyric,
    hasRomalrc: !!data.romalrc
  })

  return {
    lrc: data.lrc ? { version: data.lrc.version || 0, lyric: data.lrc.lyric || '' } : { version: 0, lyric: '' },
    tlyric: data.tlyric ? { version: data.tlyric.version || 0, lyric: data.tlyric.lyric || '' } : undefined,
    klyric: data.klyric ? { version: data.klyric.version || 0, lyric: data.klyric.lyric || '' } : undefined,
    romalrc: data.romalrc ? { version: data.romalrc.version || 0, lyric: data.romalrc.lyric || '' } : undefined,
    yrc: data.yrc ? { version: data.yrc.version || 0, lyric: data.yrc.lyric || '' } : undefined,
    ytlrc: data.ytlrc ? { version: data.ytlrc.version || 0, lyric: data.ytlrc.lyric || '' } : undefined
  }
}
