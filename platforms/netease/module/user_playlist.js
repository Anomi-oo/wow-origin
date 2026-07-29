// 获取用户歌单（包括创建和收藏的）

const getUid = require("../util/getUid")

module.exports = async (query, request) => {

  if (query.MUSIC_U) {
    query.uid = await getUid(query.MUSIC_U)
  }

  const limit = parseInt(query.limit) || 1000
  const offset = parseInt(query.offset) || 0

  const data = {
    uid: query.uid,
    limit: limit.toString(),
    offset: offset.toString()
  }

  try {
    const response = await request('/api/user/playlist', data, {
      crypto: 'eapi',
      useCheckToken: false,
      MUSIC_U: query.MUSIC_U || ''
    })

    // 响应验证
    if (!response.body || response.body.code !== 200) {
      throw new Error('User playlist request failed')
    }

    if (!response.body.playlist) {
      return { playlist: [], total: 0 }
    }

    // 格式化返回结果（统一网易云标准字段与容器名 playlist）
    return formatUserPlaylist(response.body, query.uid, query)

  } catch (error) {
    throw error
  }
}

/**
 * 格式化用户歌单（只保留核心字段）
 */
function formatUserPlaylist(data, uid, query) {
  const playlists = data.playlist || []

  // 根据query.type过滤
  // type=1: 只返回用户创建的歌单
  // type=2: 只返回用户收藏的歌单
  // 不传type: 返回所有歌单
  let filteredPlaylists = playlists

  if (query.type === '1' || query.type === 1) {
    // 只返回创建的歌单
    filteredPlaylists = playlists.filter(pl => pl.creator?.userId == uid || pl.userId == uid)
  } else if (query.type === '2' || query.type === 2) {
    // 只返回收藏的歌单
    filteredPlaylists = playlists.filter(pl => pl.creator?.userId != uid && pl.userId != uid)
  }

  return {
    playlist: filteredPlaylists.map(playlist => ({
      id: Number(playlist.id),
      name: playlist.name,
      coverImgUrl: toHttps(playlist.coverImgUrl || ''),
      trackCount: Number(playlist.trackCount || 0),
      playCount: Number(playlist.playCount || 0),
      createTime: Number(playlist.createTime || 0),
      updateTime: Number(playlist.updateTime || 0),
      creator: {
        userId: Number(playlist.creator?.userId || playlist.userId || 0),
        nickname: playlist.creator?.nickname || '',
        avatarUrl: toHttps(playlist.creator?.avatarUrl || '')
      },
      userId: Number(playlist.userId || playlist.creator?.userId || uid) || undefined,
      subscribed: Boolean(playlist.subscribed ?? (playlist.creator?.userId != uid && playlist.userId != uid)),
      privacy: playlist.privacy,
      description: playlist.description,
      tags: playlist.tags
    })),
    total: filteredPlaylists.length
  }
}

function toHttps(url) {
  if (typeof url !== 'string') return url
  return url.startsWith('http://') ? url.replace('http://', 'https://') : url
}