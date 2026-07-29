// QQ音乐已收藏专辑,需要认证信息

const { default: axios } = require('axios')

module.exports = async (query, request) => {
  const limit = Number(query.limit) || 25
  const offset = Number(query.offset) || 0
  if (!query.uin || !query.qm_keyst) {
    throw new Error("auth info missing")
  }

  const url = `https://c6.y.qq.com/fav/fcgi-bin/fcg_get_profile_order_asset.fcg?_=${Date.now()}&cv=4747474&ct=20&format=json&inCharset=utf-8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=1&uin=${query.uin}&g_tk_new_20200303=273380464&g_tk=273380464&cid=205360956&userid=${query.uin}&reqtype=2&sin=${offset}&ein=${offset + limit}`

  try {
    const response = await axios.get(url, {
      timeout: 10000,
      headers: {
        'Referer': 'https://y.qq.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
        'Cookie': `uin=${query.uin}; qm_keyst=${query.qm_keyst}`
      }
    })

    const albumData = response.data.data
    const albumlist = response.data.data.albumlist
    if (!albumlist) {
      throw new Error('not found albums')
    }

    return {
      data: albumlist.map(formatAlbumItem),
      more: (albumData.totalalbum || 0) > (offset + limit),
      total: albumData.totalalbum || 0
    }
  } catch (error) {
    throw error
  }
}


function formatAlbumItem(album) { 
  return {
    id: album.albumid,
    mid: album.albummid,
    name: album.albumname,
    coverImgUrl: `https://y.gtimg.cn/music/photo_new/T002R300x300M000${album.albummid}.jpg`,
    trackCount: Number(album.songnum || 0),
    createTime: Number(album.pubtime || 0) * 1000,
    platform: "qqmusic"
  }
}