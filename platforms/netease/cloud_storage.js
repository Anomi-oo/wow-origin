const userCloud = require('./module/user_cloud')

const CLOUD_PLAYLIST_ID = 'cloud-storage'
const CLOUD_PLAYLIST_NAME = '云盘音乐'
const CLOUD_PLAYLIST_COVER_URL = 'https://ts4.tc.mm.bing.net/th/id/OIP-C.lHkJwZb2BkwjPGWKWbxCCQHaHa?r=0&rs=1&pid=ImgDetMain&o=7&rm=3'

class CloudStorage {
  isCloudPlaylist(playlistId) {
    return String(playlistId ?? '') === CLOUD_PLAYLIST_ID
  }

  createPlaylist(trackCount = 0, tracks) {
    const playlist = {
      id: CLOUD_PLAYLIST_ID,
      name: CLOUD_PLAYLIST_NAME,
      description: '',
      coverImgUrl: CLOUD_PLAYLIST_COVER_URL,
      trackCount: this.normalizeTrackCount(trackCount),
      playCount: 0,
      subCount: 0,
      tags: [],
      creator: {
        userId: '',
        nickname: '',
        avatarUrl: ''
      },
      subscribed: true,
      createTime: 0,
      updateTime: 0
    }

    if (tracks !== undefined) {
      playlist.tracks = tracks
    }

    return playlist
  }

  async getPlaylistDetail(query, request) {
    const requestedLimit = Number.parseInt(query.n, 10)
    const metadataOnly = requestedLimit === 0
    const limit = metadataOnly ? 1 : (requestedLimit > 0 ? requestedLimit : 10000)
    const response = await userCloud({
      ...query,
      limit,
      offset: 0
    }, request)

    if (!response || response.code !== 200 || !Array.isArray(response.data)) {
      throw new Error('Cloud storage request failed')
    }

    const tracks = metadataOnly
      ? []
      : response.data
        .slice(0, limit)
        .map(item => item && item.simpleSong)
        .filter(song => song && typeof song === 'object')

    return {
      code: 200,
      playlist: this.createPlaylist(response.count, tracks)
    }
  }

  normalizeTrackCount(value) {
    const count = Number(value)
    return Number.isInteger(count) && count >= 0 ? count : 0
  }
}

CloudStorage.PLAYLIST_ID = CLOUD_PLAYLIST_ID
CloudStorage.PLAYLIST_NAME = CLOUD_PLAYLIST_NAME
CloudStorage.PLAYLIST_COVER_URL = CLOUD_PLAYLIST_COVER_URL

module.exports = CloudStorage
