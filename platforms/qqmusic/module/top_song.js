// QQ音乐新歌速递接口
// 参考文档: QQ音乐新歌接口文档.md

/**
 * QQ音乐新歌速递列表
 *
 * 参数说明:
 * - type: QQ音乐地区参数 (1=内地, 2=欧美, 3=日本, 4=韩国, 5=最新, 6=港台) [必填]
 * - 前端通过 extraParams 传入 QQ 音乐专属参数,后端直接使用,无需映射
 *
 * 返回格式:
 * {
 *   data: Song[]
 * }
 */
module.exports = (query, request) => {
  // ========== 参数处理 ==========

  // 直接使用前端通过 extraParams 传入的 QQ 音乐专属参数
  // 不需要任何映射,前端已经处理好了
  const type = parseInt(query.type) || 5  // 地区类型 (1-6), 默认最新

  // ========== 构建请求参数 ==========

  const data = {
    type: type  // QQ音乐地区参数
  }

  // ========== 发送请求 ==========

  return request('newsong.NewSongServer', 'get_new_song_info', data, {
    uin: 0,
    qm_keyst: ''
  }).then(res => {
    // 检查响应数据
    const songlist = res.body?.songlist || []

    // ========== 格式化返回数据 ==========

    return {
      data: songlist.map(formatSong)
    }
  }).catch(error => {
    // 错误处理
    throw new Error(`QQ Music top songs API error: ${error.message || 'Unknown error'}`)
  })
}

/**
 * 格式化歌曲数据为统一格式 (与search模块保持一致)
 * @param {Object} song - QQ音乐原始歌曲数据
 * @returns {Object} 格式化后的歌曲数据
 */
function formatSong(song) {
  return {
    id: song.id,
    mid: song.mid,
    name: song.name,
    ar: (song.singer || []).map(s => ({ id: s.mid, name: s.name })),
    al: {
      id: song.album ? song.album.id : 0,
      name: song.album ? song.album.name : '',
      picUrl: song.album?.mid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${song.album.mid}.jpg` : ''
    },
    dt: Number(song.interval || 0) * 1000,
    fee: song.pay.pay_play || 0,
    mv: song.mv.vid || '',
    alia: [song.subtitle],
    platform: "qqmusic"
  }
}
