// 收藏/取消收藏专辑
const e = require('express')
const albumDetail = require('./album.js')

module.exports = async (query, request) => {
  
  if(!query.uin || !query.qm_keyst){
    throw new Error("need uin and qm_keyst")
  } else if(!query.id){
    throw new Error("need id")
  } else if(!query.t){
    throw new Error("need t")
  }

  const method = query.t == 1 ? 'FavAlbum' : 'CancelFavAlbum'

  const mid = await albumDetail({id: query.id}, request).then(res => {
    if(!res.album){
      throw new Error("not found album")
    }
    return res.album.mid
  })

  const data = {
    "uin": String(query.uin),
    "v_albumMid": [
      mid
    ]
  }
  return request("music.musicasset.AlbumFavWrite", method, data, {
      uin: query.uin,
      qm_keyst: query.qm_keyst
  }) 
}