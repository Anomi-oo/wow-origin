// 网易云音乐歌单详情
const Logger = require('../../../core/Logger')
const logger = new Logger({ component: 'netease-playlist-detail' })

/**
 * 网易云音乐歌单详情模块
 * - tracks最多返回1000首，trackIds可超出
 */
module.exports = (query, request) => {
  const playlistId = query.id

  const limit = parseInt(query.n) || 10000
  const subscribers = 0

  const data = {
    id: playlistId,
    n: limit,
    s: subscribers
  }

  return request(`/api/v6/playlist/detail`, data, {
    crypto: '',
    useCheckToken: false,
    MUSIC_U: query.MUSIC_U || ''
  }).then(response => {

    if (!response.body || response.body.code !== 200 || !response.body.playlist) {
      throw new Error('Playlist detail request failed')
    }

    return response.body
  }).catch(error => {
    logger.error('NetEase playlist detail failed', {
      error: error.message,
      playlistId
    })
    throw error
  })
}


