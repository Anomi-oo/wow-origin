// 搜索

const Logger = require('../../../core/Logger')
const logger = new Logger({ component: 'netease-search' })

module.exports = async (query, request) => {


  const searchType = query.type || 1
  logger.info('Netease search request', {
    keywords: query.keywords,
    type: searchType,
    limit: query.limit || 30,
    offset: query.offset || 0
  })

  // 语音搜索
  if (query.type && query.type == '2000') {
    const data = {
      keyword: query.keywords,
      scene: 'normal',
      limit: query.limit || 30,
      offset: query.offset || 0,
    }
    try {
      const response = await request(`/api/search/voice/get`, data, {
        crypto: 'api',
        useCheckToken: false,
        MUSIC_U: ''
      })
      return formatVoiceSearchResult(response.body, query)
    } catch (error) {
      logger.error('Netease voice search failed', {
        error: error.message,
        keywords: query.keywords
      })
      throw error
    }
  }

  // 常规搜索
  const data = {
    s: query.keywords,
    type: searchType, // 1: 单曲, 10: 专辑, 100: 歌手, 1000: 歌单, 1002: 用户, 1004: MV, 1006: 歌词, 1009: 电台, 1014: 视频
    limit: query.limit || 30,
    offset: query.offset || 0,
  }

  try {
    const response = await request(`/api/search/get`, data, {
      crypto: 'api',
      useCheckToken: false,
      MUSIC_U: ''
    })

    // 响应验证
    if (!response.body || response.body.code !== 200) {
      logger.error('Netease search failed', {
        code: response.body?.code,
        status: response.status
      })
      throw new Error('Search request failed')
    }

    if (!response.body.result) {
      logger.warn('No search result returned')
      return formatEmptyResult(searchType)
    }

    logger.info('Netease search success', {
      type: searchType,
      hasResult: !!response.body.result
    })

    // 根据搜索类型返回不同的格式化结果
    switch (parseInt(searchType)) {
      case 1: // 单曲搜索
        return formatSongSearchResult(response.body.result, query)
      case 10: // 专辑搜索
        return formatAlbumSearchResult(response.body.result, query)
      case 100: // 歌手搜索
        return formatArtistSearchResult(response.body.result, query)
      case 1000: // 歌单搜索
        return formatPlaylistSearchResult(response.body.result, query)
      case 1002: // 用户搜索
        return formatUserSearchResult(response.body.result, query)
      case 1004: // MV搜索
        return formatMVSearchResult(response.body.result, query)
      case 1006: // 歌词搜索
        return formatLyricSearchResult(response.body.result, query)
      case 1009: // 电台搜索
        return formatDjRadioSearchResult(response.body.result, query)
      case 1014: // 视频搜索
        return formatVideoSearchResult(response.body.result, query)
      default:
        return formatSongSearchResult(response.body.result, query)
    }
  } catch (error) {
    logger.error('Netease search failed', {
      error: error.message,
      keywords: query.keywords,
      type: searchType
    })
    throw error
  }
}

/**
 * 格式化单曲搜索结果
 */
function formatSongSearchResult(data, query) {
  const songs = data.songs || []
  const limit = parseInt(query.limit) || 30
  const offset = parseInt(query.offset) || 0
  const songCount = data.songCount || songs.length
  const hasMore = offset + songs.length < songCount

  // 直接返回网易云字段（ar/al/dt/fee/mv...），保证前端格式化函数可用
  return {
    result: {
      songs: songs.map(song => ({
        ...song,
        platform: 'netease'
      })),
      songCount: songCount,
      hasMore: hasMore
    }
  }
}

/**
 * 格式化专辑搜索结果
 */
function formatAlbumSearchResult(data, query) {
  const albums = data.albums || []

  return {
    result: {
      albums: albums.map(album => ({
        id: album.id,
        name: album.name,
        artist: album.artist?.name || (album.artists ? album.artists.map(a => a.name).join(', ') : ''),
        artists: album.artists ? album.artists.map(a => ({
          id: a.id,
          name: a.name,
          alias: a.alias || [],
          trans: a.trans || null
        })) : (album.artist ? [{
          id: album.artist.id,
          name: album.artist.name,
          alias: album.artist.alias || [],
          trans: album.artist.trans || null
        }] : []),
        picUrl: album.picUrl || (album.blurPicUrl || ''),
        picId: album.picId || 0,
        size: album.size || 0,
        publishTime: album.publishTime || 0,
        company: album.company || '',
        status: album.status || 0,
        copyrightId: album.copyrightId || 0,
        mark: album.mark || 0
      })),
      albumCount: data.albumCount || albums.length
    }
  }
}

/**
 * 格式化歌手搜索结果
 */
function formatArtistSearchResult(data, query) {
  const artists = data.artists || []

  return {
    result: {
      artists: artists.map(artist => ({
        id: artist.id,
        name: artist.name,
        picUrl: artist.picUrl || artist.img1v1Url || '',
        picId: artist.picId || 0,
        img1v1: artist.img1v1 || 0,
        img1v1Url: artist.img1v1Url || '',
        alias: artist.alias || [],
        trans: artist.trans || null,
        albumSize: artist.albumSize || 0,
        mvSize: artist.mvSize || 0,
        accountId: artist.accountId || 0,
        followed: artist.followed || false,
        identityIconUrl: artist.identityIconUrl || null
      })),
      artistCount: data.artistCount || artists.length
    }
  }
}

/**
 * 格式化歌单搜索结果
 */
function formatPlaylistSearchResult(data, query) {
  const playlists = data.playlists || []

  return {
    result: {
      playlists: playlists.map(playlist => ({
        id: playlist.id,
        name: playlist.name,
        coverImgUrl: playlist.coverImgUrl || '',
        creator: {
          userId: playlist.creator?.userId || playlist.userId || 0,
          nickname: playlist.creator?.nickname || '',
          avatarUrl: playlist.creator?.avatarUrl || '',
          userType: playlist.creator?.userType || 0,
          authStatus: playlist.creator?.authStatus || 0
        },
        trackCount: playlist.trackCount || 0,
        playCount: playlist.playCount || 0,
        bookCount: playlist.bookCount || 0,
        subscribed: playlist.subscribed || false,
        description: playlist.description || '',
        highQuality: playlist.highQuality || false,
        specialType: playlist.specialType || 0,
        officialTags: playlist.officialTags || null,
        playlistType: playlist.playlistType || ''
      })),
      playlistCount: data.playlistCount || playlists.length
    }
  }
}

/**
 * 格式化用户搜索结果
 */
function formatUserSearchResult(data, query) {
  const users = data.userprofiles || []

  return {
    result: {
      users: users.map(user => ({
        userId: user.userId,
        nickname: user.nickname,
        avatarUrl: user.avatarUrl || '',
        signature: user.signature || '',
        gender: user.gender || 0,
        province: user.province || 0,
        city: user.city || 0,
        birthday: user.birthday || 0,
        userType: user.userType || 0,
        authStatus: user.authStatus || 0,
        followed: user.followed || false,
        followeds: user.followeds || 0,
        follows: user.follows || 0,
        playlistCount: user.playlistCount || 0,
        vipType: user.vipType || 0
      })),
      userCount: data.userprofileCount || users.length
    }
  }
}

/**
 * 格式化MV搜索结果
 */
function formatMVSearchResult(data, query) {
  const mvs = data.mvs || []

  return {
    result: {
      mvs: mvs.map(mv => ({
        id: mv.id,
        name: mv.name,
        artist: mv.artists ? mv.artists.map(a => a.name).join(', ') : (mv.artistName || ''),
        artists: mv.artists ? mv.artists.map(a => ({
          id: a.id,
          name: a.name,
          alias: a.alias || []
        })) : (mv.artistId ? [{
          id: mv.artistId,
          name: mv.artistName || '',
          alias: []
        }] : []),
        cover: mv.cover || '',
        duration: mv.duration || 0,
        playCount: mv.playCount || 0,
        publishTime: mv.publishTime || '',
        desc: mv.desc || '',
        briefDesc: mv.briefDesc || ''
      })),
      mvCount: data.mvCount || mvs.length
    }
  }
}

/**
 * 格式化歌词搜索结果
 */
function formatLyricSearchResult(data, query) {
  const songs = data.songs || []

  return {
    result: {
      songs: songs.map(song => ({
        id: song.id,
        name: song.name,
        artist: song.artists ? song.artists.map(a => a.name).join(', ') : '',
        artists: song.artists ? song.artists.map(a => ({
          id: a.id,
          name: a.name
        })) : [],
        album: {
          id: song.album?.id || 0,
          name: song.album?.name || '',
          pic: song.album?.picUrl || ''
        },
        duration: song.duration || 0,
        lyrics: song.lyrics || []
      })),
      songCount: data.songCount || songs.length
    }
  }
}

/**
 * 格式化电台搜索结果
 */
function formatDjRadioSearchResult(data, query) {
  const djRadios = data.djRadios || []

  return {
    result: {
      djRadios: djRadios.map(radio => ({
        id: radio.id,
        name: radio.name,
        picUrl: radio.picUrl || '',
        desc: radio.desc || '',
        category: radio.category || '',
        subCount: radio.subCount || 0,
        programCount: radio.programCount || 0,
        dj: {
          userId: radio.dj?.userId || 0,
          nickname: radio.dj?.nickname || '',
          avatarUrl: radio.dj?.avatarUrl || ''
        }
      })),
      djRadioCount: data.djRadiosCount || djRadios.length
    }
  }
}

/**
 * 格式化视频搜索结果
 */
function formatVideoSearchResult(data, query) {
  const videos = data.videos || []

  return {
    result: {
      videos: videos.map(video => ({
        id: video.vid,
        title: video.title,
        coverUrl: video.coverUrl || '',
        duration: video.durationms || 0,
        playTime: video.playTime || 0,
        creator: video.creator ? video.creator.map(c => ({
          userId: c.userId,
          nickname: c.userName
        })) : [],
        description: video.description || ''
      })),
      videoCount: data.videoCount || videos.length
    }
  }
}

/**
 * 格式化语音搜索结果
 */
function formatVoiceSearchResult(data, query) {
  // 语音搜索结果可能需要特殊处理
  return {
    result: data || {}
  }
}

/**
 * 返回空结果
 */
function formatEmptyResult(type) {
  const typeMap = {
    1: { songs: [], songCount: 0 },
    10: { albums: [], albumCount: 0 },
    100: { artists: [], artistCount: 0 },
    1000: { playlists: [], playlistCount: 0 },
    1002: { users: [], userCount: 0 },
    1004: { mvs: [], mvCount: 0 },
    1006: { songs: [], songCount: 0 },
    1009: { djRadios: [], djRadioCount: 0 },
    1014: { videos: [], videoCount: 0 }
  }

  return {
    result: typeMap[type] || { songs: [], songCount: 0 }
  }
}
