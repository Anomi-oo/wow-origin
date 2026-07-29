// 编辑歌单，更改简介不生效

const PLAYLIST_CATEGORY_MAP = {
  // ===== 热门 (1个) =====
  "全部": 10000000,

  // ===== 语种 (9个) =====
  "国语": 165,
  "英语": 167,
  "韩语": 168,
  "粤语": 166,
  "日语": 169,
  "小语种": 170,
  "闽南语": 203,
  "法语": 204,
  "拉丁语": 205,

  // ===== 流派 (16个) =====
  "流行": 6,
  "轻音乐": 15,
  "摇滚": 11,
  "民谣": 28,
  "R&B": 8,
  "嘻哈": 153,
  "电子": 24,
  "古典": 27,
  "乡村": 18,
  "蓝调": 22,
  "爵士": 21,
  "新世纪": 164,
  "拉丁": 25,
  "后摇": 218,
  "中国传统": 219,
  "世界音乐": 220,

  // ===== 主题 (17个) =====
  "ACG": 39,
  "经典": 136,
  "网络歌曲": 146,
  "影视": 133,
  "KTV热歌": 141,
  "儿歌": 131,
  "中国风": 145,
  "古风": 194,
  "情歌": 148,
  "城市": 196,
  "现场音乐": 197,
  "背景音乐": 199,
  "佛教音乐": 200,
  "UP主": 201,
  "乐器": 202,
  "MC喊麦": 226,
  "DJ": 14,

  // ===== 心情 (9个) =====
  "伤感": 52,
  "安静": 122,
  "快乐": 117,
  "治愈": 116,
  "励志": 125,
  "甜蜜": 59,
  "寂寞": 55,
  "宣泄": 126,
  "思念": 68,

  // ===== 场景 (13个) =====
  "睡前": 78,
  "夜店": 102,
  "学习": 101,
  "运动": 99,
  "开车": 85,
  "约会": 76,
  "工作": 94,
  "旅行": 81,
  "派对": 103,
  "婚礼": 222,
  "咖啡馆": 223,
  "跳舞": 224,
  "校园": 16
}

const getPlaylistCreated = require('./user_playlist_created')

module.exports = async(query, request) => {
  const desc = query.desc || ''
  const tags = query.tags?.split(';') || []
  const name = query.name || ''
  const tagIds = tags.map(tag => {
    for (const [name, id] of Object.entries(PLAYLIST_CATEGORY_MAP)) {
      if (name === tag) {
        return id
      }
    }
    return null
  }).filter(id => id !== null).join(',')

  const playlistCreated = await getPlaylistCreated(query, request)
  const playlistId = Number(query.id)
  const dirId = playlistCreated.playlist.find(pl => pl.id === playlistId)?.dirId
  if (!dirId) {
    throw new Error('Playlist not found or not created by user')
  }

  const uin = query.uin || 0
  const qm_keyst = query.qm_keyst || ''
  

  const data = {
    "dirId": dirId,
    "mask": 15,
    "dirNewName": name,
    "dirNewDesc": desc,
    "dirNewPicUrl": "",
    "dirNewtaglist": tagIds
  }

  return request("music.musicasset.PlaylistBaseWrite", "EditPlaylist", data, {
    uin: uin,
    qm_keyst: qm_keyst
  }).then(res => {
    return res.body
  })
}
