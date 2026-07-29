//分类歌单
const { getPlaylistCategoryMap } = require('../config')

module.exports = (query, request) => {
  const limit = parseInt(query.limit) || 50
  const offset = parseInt(query.offset) || 0
  const page = Math.floor(offset / limit) || 0
  const category = query.category ?? query.cat
  const categoryId = resolveCategoryId(category)

  const data = {
    "caller": "0",
    "category_id": categoryId,
    "size": limit,
    "page": page,
    "use_page": 1
  }

  return request("music.playlist.PlayListCategory", "get_category_content", data, {
    uin: 0,
    qm_keyst: ''
  }).then(res => {
    return {
      playlists: (res.body?.content.v_item || []).map(formatPlaylist),
      total: res.body?.content.total_cnt || 0,
      hasMore: (page + 1) * limit < (res.body?.content.total_cnt || 0),
    }
  })
}

function resolveCategoryId(category) {
  if (category !== undefined && category !== null && /^\d+$/.test(String(category))) {
    return Number(category)
  }
  return getPlaylistCategoryMap()[category] || 3317
}

/**
 * 格式化歌单搜索结果
 */
function formatPlaylist(playlist) {
  return {
    id: playlist.basic.tid,
    name: playlist.basic.title,
    coverImgUrl: playlist.basic.cover.default_url || '',
    creator: {
      userId: playlist.basic.creator?.uin || 123456789,
      nickname: playlist.basic.creator?.nick || ''
    },
    trackCount: playlist.basic.song_cnt || 0,
    playCount: playlist.basic.play_cnt || 0,
    description: playlist.basic.desc || '',
    createTime: playlist.basic.create_time || '',
    modifyTime: playlist.basic.modify_time || '',
    platform: "qqmusic"
  }
}
