const getUserPlaylist = require('./user_playlist')

module.exports = async (query, request) => {
  const id = query.id
  const uin = query.uin
  const qm_keyst = query.qm_keyst

  if (!id && !query.dirId) {
    throw new Error('Playlist id is required')
  }

  if (!uin || !qm_keyst) {
    throw new Error('uin and qm_keyst are required')
  }

  // 如果提供了dirId，直接使用；否则通过id查找dirId
  let dirId = query.dirId
  if (!dirId) {
    dirId = await id2dirId(id, uin, qm_keyst, request)
    if (!dirId) {
      throw new Error(`Cannot find dirId for playlist id: ${id}`)
    }
  }

  const data = {
    "dirId": Number(dirId)
  }

  return request("music.musicasset.PlaylistBaseWrite", "DelPlaylist", data, {
    uin: uin,
    qm_keyst: qm_keyst
  }).then(res => {
    return {
      id: res.body.result.tid,
      playlist: {
        id: res.body.result.tid,
        name: res.body.result.dirName
      }
    }
  })
}

/**
 * 将歌单id映射为dirId
 * @param {string|number} id - 歌单id (tid)
 * @param {string} uin - 用户uin
 * @param {string} qm_keyst - 用户认证cookie
 * @param {Function} request - 请求函数
 * @returns {Promise<number|null>} dirId或null
 */
const id2dirId = async (id, uin, qm_keyst, request) => {
  try {
    // 获取用户创建的歌单（type=1）
    const result = await getUserPlaylist({ uin, qm_keyst, type: 1 }, request)

    if (result && result.playlist) {
      const playlist = result.playlist.find(p => p.id === Number(id))
      return playlist ? playlist.dirId : null
    }

    return null
  } catch (error) {
    throw new Error(`Failed to get dirId for playlist ${id}: ${error.message}`)
  }
}