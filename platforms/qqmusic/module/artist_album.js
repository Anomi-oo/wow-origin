//歌手专辑

module.exports = (query, request) => {
  const data = {
    "singerMid": query.id,
    "order": 1,
    "num": Number(query.limit) || 50,
    "begin": Number(query.offset) || 0,
  }

  return request("music.musichallAlbum.AlbumListServer", "GetAlbumList", data, {
    uin: 0,
    qm_keyst: ''
  }).then(res => {
    if (!res.body || !res.body.albumList) {
      throw new Error("not found album")
    }
    return {
      hotAlbums: res.body.albumList.map(formatAlbumItem),
      more: res.body.total > (query.offset + query.limit),
      total: res.body.total
    }
  })
}

function formatAlbumItem(album) {
  return {
    id: album.albumID,
    mid: album.albumMid,
    name: album.albumName,
    artistName: album.singerName,
    coverUrl: `https://y.gtimg.cn/music/photo_new/T002R300x300M000${album.albumMid}.jpg`,
    trackCount: Number(album.totalNum || 0),
    publishTime: new Date(album.publishDate || 0).getTime() || null,
    platform: "qqmusic"
  }
}