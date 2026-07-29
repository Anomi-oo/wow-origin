// 创建歌单
const Logger = require('../../../core/Logger')
const logger = new Logger({ component: 'netease-user-playlist' })

module.exports = async (query, request) => {
  const data = {
    name: query.name,
    privacy: query.privacy || '10', // 0 普通歌单, 10 隐私歌单
    type: query.type || 'NORMAL', // 默认 NORMAL, VIDEO 视频歌单, SHARED 共享歌单
  }
  return request(`/api/playlist/create`, data, {
      crypto: "eapi",
      useCheckToken: true,
      MUSIC_U: query.MUSIC_U
  }).then(res => {
    return res.body
  })
}

