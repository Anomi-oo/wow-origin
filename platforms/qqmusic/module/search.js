const { default: axios } = require('axios')

const PRIMARY_SEARCH_URL = 'http://u6.y.qq.com/cgi-bin/musicu.fcg'
const LEGACY_SEARCH_URL = 'https://c.y.qq.com/soso/fcgi-bin/client_search_cp'
const LEGACY_PLAYLIST_SEARCH_URL = 'https://c.y.qq.com/soso/fcgi-bin/client_music_search_songlist'
const USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1 Edg/131.0.0.0'

// 网易云标准类型 -> QQ 新版搜索类型。
const SEARCH_TYPE_MAP = { 1: 0, 10: 2, 100: 1, 1000: 3, 1004: 4 }
const LEGACY_TYPE_MAP = { 0: 0, 1: 9, 2: 8, 4: 12 }
const LEGACY_SECTION_MAP = { 0: 'song', 1: 'singer', 2: 'album', 4: 'mv' }

module.exports = async query => {
  const limit = Math.min(parseInt(query.limit) || 30, 30)
  const offset = parseInt(query.offset) || 0
  const pageNum = Math.floor(offset / limit) + 1
  const stdType = parseInt(query.type) || 1
  const mappedType = SEARCH_TYPE_MAP[stdType]

  if (mappedType === undefined) {
    throw new Error('Unsupported search type')
  }

  try {
    return await searchPrimary(query.keywords, mappedType, offset, limit, pageNum)
  } catch (error) {
    console.warn(
      `[qqmusic-search] primary search failed, using legacy CGI: ${safeErrorMessage(error)}`
    )
    return searchLegacy(query.keywords, mappedType, offset, limit, pageNum)
  }
}

async function searchPrimary(keywords, mappedType, offset, limit, pageNum) {
  const requestData = {
    comm: {
      ct: '19',
      cv: '1859',
      uin: '0'
    },
    req_1: {
      method: 'DoSearchForQQMusicDesktop',
      module: 'music.search.SearchCgiService',
      param: {
        grp: 1,
        num_per_page: limit,
        page_num: pageNum,
        query: keywords,
        search_type: mappedType
      }
    }
  }

  const response = await axios.post(PRIMARY_SEARCH_URL, requestData, {
    timeout: 10000,
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT
    }
  })
  const topCode = Number(response.data?.code)
  const requestResult = response.data?.req_1
  const requestCode = Number(requestResult?.code)

  if (topCode !== 0 || requestCode !== 0) {
    throw new Error(
      requestResult?.message
      || response.data?.message
      || `QQ search request failed (${Number.isFinite(requestCode) ? requestCode : topCode})`
    )
  }

  const body = requestResult?.data?.body || {}
  const meta = requestResult?.data?.meta || {}
  const list = getPrimaryList(body, mappedType)
  const total = Number(meta.sum) || list.length
  const hasMore = Number(meta.nextpage) > 0 || offset + list.length < total
  return formatSearchResult(mappedType, list, total, hasMore)
}

async function searchLegacy(keywords, mappedType, offset, limit, pageNum) {
  if (mappedType === 3) {
    const response = await axios.get(LEGACY_PLAYLIST_SEARCH_URL, {
      timeout: 10000,
      params: {
        format: 'json',
        remoteplace: 'txt.yqq.playlist',
        query: keywords,
        page_no: pageNum - 1,
        num_per_page: limit
      },
      headers: legacyHeaders()
    })
    const data = normalizeResponseData(response.data)
    if (Number(data?.code) !== 0) {
      throw new Error(data?.message || `QQ legacy playlist search failed (${data?.code})`)
    }
    const result = data?.data || {}
    const list = Array.isArray(result.list) ? result.list : []
    const total = Number(result.display_num ?? result.sum) || list.length
    return formatSearchResult(mappedType, list, total, offset + list.length < total)
  }

  const legacyType = LEGACY_TYPE_MAP[mappedType]
  const sectionName = LEGACY_SECTION_MAP[mappedType]
  if (legacyType === undefined || !sectionName) {
    throw new Error('Unsupported legacy search type')
  }

  const response = await axios.get(LEGACY_SEARCH_URL, {
    timeout: 10000,
    params: {
      format: 'json',
      n: limit,
      p: pageNum,
      w: keywords,
      cr: 1,
      g_tk: 5381,
      t: legacyType
    },
    headers: legacyHeaders()
  })
  const data = normalizeResponseData(response.data)
  if (Number(data?.code) !== 0) {
    throw new Error(data?.message || `QQ legacy search failed (${data?.code})`)
  }
  const result = data?.data?.[sectionName] || {}
  const list = Array.isArray(result.list) ? result.list : []
  const total = Number(result.totalnum) || list.length
  return formatSearchResult(mappedType, list, total, offset + list.length < total)
}

function getPrimaryList(body, mappedType) {
  const sectionMap = {
    0: body.song,
    1: body.singer,
    2: body.album,
    3: body.songlist,
    4: body.mv
  }
  const list = sectionMap[mappedType]?.list
  return Array.isArray(list) ? list : []
}

function formatSearchResult(mappedType, list, total, hasMore) {
  switch (mappedType) {
    case 0:
      return {
        result: {
          songs: list.map(formatSongSearchResult),
          songCount: total,
          hasMore
        }
      }
    case 1:
      return {
        result: {
          artists: list.map(formatSingerSearchResult),
          artistCount: total,
          hasMore
        }
      }
    case 2:
      return {
        result: {
          albums: list.map(formatAlbumSearchResult),
          albumCount: total,
          hasMore
        }
      }
    case 3:
      return {
        result: {
          playlists: list.map(formatPlaylistSearchResult),
          playlistCount: total,
          hasMore
        }
      }
    case 4:
      return {
        result: {
          mvs: list.map(formatMvSearchResult),
          mvCount: total,
          hasMore
        }
      }
    default:
      throw new Error('Unsupported search type')
  }
}

function formatSongSearchResult(song) {
  const album = song.album || {}
  const albumId = album.id ?? song.albumid ?? 0
  const albumMid = album.mid || song.albummid || ''
  const albumName = album.name || song.albumname || ''

  return {
    id: song.id ?? song.songid,
    mid: song.mid || song.songmid,
    name: song.name || song.songname || '',
    ar: (song.singer || []).map(singer => ({
      id: singer.mid || singer.id,
      name: singer.name || ''
    })),
    al: {
      id: albumId,
      name: albumName,
      picUrl: albumMid
        ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg`
        : ''
    },
    dt: Number(song.interval || 0) * 1000,
    fee: song.pay?.pay_play ?? song.pay?.payplay ?? 0,
    mv: song.mv?.vid || song.vid || '',
    alia: song.subtitle ? [song.subtitle] : [],
    platform: 'qqmusic'
  }
}

function formatSingerSearchResult(singer) {
  return {
    id: singer.singerMID || singer.mid || singer.id,
    name: singer.singerName || singer.name || '',
    picUrl: singer.singerPic || singer.picUrl || '',
    platform: 'qqmusic'
  }
}

function formatAlbumSearchResult(album) {
  const artistName = album.singer_list
    ? album.singer_list.map(singer => singer.name).filter(Boolean).join(', ')
    : album.singerName || ''

  return {
    id: album.albumID ?? album.id,
    mid: album.albumMID || album.mid,
    name: album.albumName || album.name || '',
    artistName,
    picUrl: album.albumPic
      || (album.albumMID
        ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${album.albumMID}.jpg`
        : ''),
    size: album.song_count || 0,
    publishTime: album.publicTime || '',
    company: album.company || '',
    platform: 'qqmusic'
  }
}

function formatPlaylistSearchResult(playlist) {
  return {
    id: playlist.dissid ?? playlist.id,
    name: playlist.dissname || playlist.name || '',
    coverImgUrl: playlist.imgurl || playlist.coverImgUrl || '',
    creator: {
      userId: playlist.creator?.creator_uin ?? playlist.creator?.uin ?? 0,
      nickname: playlist.creator?.name || '',
      isVip: playlist.creator?.isVip || 0
    },
    trackCount: playlist.song_count || playlist.trackCount || 0,
    playCount: playlist.listennum || playlist.playCount || 0,
    playCountStr: playlist.listennumstr || '',
    description: playlist.introduction || playlist.description || '',
    createTime: playlist.createtime || playlist.createTime || '',
    modifyTime: playlist.modifytime || playlist.modifyTime || '',
    platform: 'qqmusic'
  }
}

function formatMvSearchResult(mv) {
  return {
    id: mv.v_id || mv.vid || mv.id,
    name: mv.mv_name || mv.name || '',
    artistName: mv.singer_name || mv.singerName || '',
    artistId: mv.singerMID || mv.singermid || mv.singer_list?.[0]?.mid || '',
    duration: Number(mv.duration || 0) * 1000,
    cover: mv.mv_pic_url || mv.cover || '',
    playCount: mv.play_count || 0,
    publishTime: mv.publish_date || '',
    platform: 'qqmusic'
  }
}

function legacyHeaders() {
  return {
    Referer: 'https://y.qq.com/',
    'User-Agent': USER_AGENT
  }
}

function normalizeResponseData(value) {
  if (typeof value !== 'string') return value
  const json = value.replace(/^(?:callback|MusicJsonCallback|jsonCallback)\(|\)$/g, '')
  return JSON.parse(json)
}

function safeErrorMessage(error) {
  return error instanceof Error ? error.message.slice(0, 256) : String(error).slice(0, 256)
}
