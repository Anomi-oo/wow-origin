//歌手专辑

module.exports = (query, request) => {
  const data = {
    "singerid": 0,
    "singermid": query.id,
    "tagid": 0,
    "start": Number(query.offset) || 0,
    "count": Number(query.limit) || 50,
    "order": 1
  }

  return request("MvService.MvInfoProServer", "GetSingerMvList", data, {
    uin: 0,
    qm_keyst: ''
  }).then(res => {
    if (!res.body || !res.body.list) {
      throw new Error("not found mv")
    }
    return {
      mvs: res.body.list.map(formatMvItem),
      hasMore: res.body.total > (query.offset + query.limit),
      total: res.body.total
    }
  })
}

function formatMvItem(mv) {
  return {
    id: mv.vid,
    name: mv.title,
    coverImgUrl: mv.picurl,
    playCount: Number(mv.playcnt || 0),
    platform: "qqmusic"
  }
}