//歌手详情

module.exports = (query, request) => {

  const data = {
      "singer_mids": [
        query.id
      ],
      "pic": 1,
      "group_singer": 1,
      "wiki_singer": 1,
      "ex_singer": 1
  }

  return request("music.musichallSinger.SingerInfoInter", "GetSingerDetail", data, {
    uin: 0,
    qm_keyst: '',
  }).then(res => {
    const artist = res.body?.singer_list?.[0]
    if(!artist?.basic_info) {
      throw new Error("not found artist")
    }
    return formatFollowSingerList(artist)
  })
}

function formatFollowSingerList(data) {
  const basicInfo = data.basic_info || {}
  const pic = data.pic || {}
  const extraInfo = data.ex_info || {}

  return {
    data: {
      artist: {
        id: basicInfo.singer_mid || "",
        name: basicInfo.name || "",
        picUrl: pic.pic || "",
        alias: [],
        description: extraInfo.desc || "",
        musicSize: 0,
        albumSize: 0,
        mvSize: 0,
      },
      platform: "qqmusic"
    }
  }
}
