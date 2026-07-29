// 数字专辑详情
const { default: axios } = require('axios')

module.exports = async (query, request) => {
  // id 参数
  const albumid = query.id

  if (!albumid) {
    throw new Error('Missing album id') 
  }

  const url = `https://c6.y.qq.com/v8/fcg-bin/fcg_v8_album_info_cp.fcg?ct=24&albumid=${albumid}&cv=4747474&ct=24&format=json&inCharset=utf-8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=1&g_tk_new_20200303=273380464&g_tk=273380464`

  try {
    const response = await axios.get(url, {
      timeout: 10000,
      headers: {
        'Referer': 'https://y.qq.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0'
      }
    })

    return response.data.data;
  } catch (error) {
    throw error
  }
}

function formatAlbumDetail(data) {
  const albumData = data.data

  return {
    album: {
      id: Number(albumData.id),
      mid: albumData.mid,
      name: albumData.name,
      coverImgUrl: `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumData.mid}.jpg`,
      trackCount: Number(albumData.total_song_num || 0),
      playCount: 0,
      subCount: 0,
      createTime: albumData.aDate, // 使用aDate字段需要解析
      updateTime: 0,
      tags: [albumData.genre || ''],
      description: albumData.desc || '',
      artist: {
        id: albumData.singermid || '',
        name: albumData.singername || '',
        picUrl: `https://y.gtimg.cn/music/photo_new/T001R300x300M000${albumData.singermid}.jpg`
      }
    },
    songs: (albumData.list || []).map((song) => ({
      id: song.songid,
      name: song.songname,
      ar: (song.singer || []).map(a => ({ id: a.mid, name: a.name, picUrl: '', img1v1Url: '', alias: [] })),
      al: { id: song.albumid || 0, name: song.albumname || '', picUrl: `https://y.gtimg.cn/music/photo_new/T002R300x300M000${song.albummid}.jpg` },
      dt: Number((song.interval || 0) * 1000), // 转换为毫秒
      fee: song.pay?.payplay === 1 ? 1 : 0,
      mv: song.vid || '',
      alia: [],
      platform: "qqmusic"
    })),
    platform: 'qqmusic'
  }
}
