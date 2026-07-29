const songUrl = require('./song_url')

/**
 * QQ音乐歌曲URL获取
 * 基于vkey.GetVkeyServer接口实现
 * 支持VIP账号cookie认证
 */
module.exports = (query, request) => {
  return songUrl(query, request)
}