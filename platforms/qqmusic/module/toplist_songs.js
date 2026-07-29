// QQ音乐排行榜详情
const { default: axios } = require('axios')

/**
 * 获取排行榜详情（歌曲列表）
 */
module.exports = async (query, request) => {
  const topId = query.id || query.topId

  if (!topId) {
    throw new Error('Top list id is required')
  }

  const limit = parseInt(query.limit) || 100
  const offset = parseInt(query.offset) || 0

  try {
    const requestData = {
      comm: {
        cv: 1602,
        ct: 20
      },
      toplist: {
        module: 'musicToplist.ToplistInfoServer',
        method: 'GetDetail',
        param: {
          topid: parseInt(topId),
          num: limit,
          period: ''
        }
      }
    }

    const url = 'https://u.y.qq.com/cgi-bin/musicu.fcg?' +
      `format=json&inCharset=utf8&outCharset=utf-8&platform=yqq.json&needNewCode=0&data=${encodeURIComponent(JSON.stringify(requestData))}`

    const response = await axios.get(url, {
      timeout: 15000,
      headers: {
        'Referer': 'https://y.qq.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0'
      }
    })

    const data = response.data

    if (!data || !data.toplist || !data.toplist.data) {
      throw new Error('Invalid toplist detail response')
    }

    const toplistData = data.toplist.data

    // 排行榜信息
    const info = {
      id: topId,
      title: toplistData.data?.title || '',
      description: toplistData.data?.intro || '',
      coverUrl: toplistData.data?.frontPicUrl || toplistData.data?.headPicUrl || '',
      listenNum: toplistData.data?.listenNum || 0,
      updateTime: toplistData.updateTime || '',
      period: period || '',
      totalSong: toplistData.totalNum || 0,
      url: `https://y.qq.com/n/ryqq/toplist/${topId}`
    }

    // 歌曲列表
    const songs = (toplistData.songInfoList || []).map((song, index) => ({
      id: song.id,
      mid: song.mid,
      name: song.name || song.title,
      title: song.title || song.name,
      subtitle: song.subtitle || '',
      rank: index + 1 + offset,
      // 艺术家
      artist: song.singer ? song.singer.map(s => s.name).join('/') : '',
      artists: song.singer ? song.singer.map(s => ({
        id: s.id,
        mid: s.mid,
        name: s.name
      })) : [],
      // 专辑
      album: {
        id: song.album?.id || 0,
        mid: song.album?.mid || '',
        name: song.album?.name || '',
        pic: song.album?.mid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${song.album.mid}.jpg` : ''
      },
      duration: song.interval || 0,
      pic: song.album?.mid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${song.album.mid}.jpg` : '',
      // MV信息
      mv: {
        id: song.mv?.id || 0,
        vid: song.mv?.vid || ''
      },
      // VIP信息
      isVip: song.pay ? song.pay.pay_play === 1 : false,
      fee: song.pay?.pay_play || 0,
      // 文件信息
      file: {
        mediaMid: song.file?.media_mid || '',
        size128mp3: song.file?.size_128mp3 || 0,
        size320mp3: song.file?.size_320mp3 || 0,
        sizeFlac: song.file?.size_flac || 0
      }
    }))

    return {
      info,
      songs,
      total: songs.length
    }

  } catch (error) {
    throw error
  }
}