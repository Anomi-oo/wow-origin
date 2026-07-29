// QQ音乐已收藏MV列表，需要认证信息

const { default: axios } = require('axios')

module.exports = async (query, request) => {
  const limit = Number(query.limit) || 12
  const offset = Number(query.offset) || 0

  if (!query.uin || !query.qm_keyst) {
    throw new Error('auth info missing')
  }

  const url = `https://c6.y.qq.com/mv/fcgi-bin/fcg_get_myfav_mv.fcg?reqtype=1&support=1&cid=205361447&encuin=${query.uin}&qq=${query.uin}&rnd=${Math.random()}&_=${Date.now()}&cv=4747474&ct=24&format=json&inCharset=utf-8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=1&uin=${query.uin}&g_tk_new_20200303=495077030&g_tk=495077030&num=${offset}&pagesize=${limit}`

  try {
    const response = await axios.get(url, {
      timeout: 10000,
      headers: {
        'Referer': 'https://y.qq.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
        'Cookie': `uin=${query.uin}; qm_keyst=${query.qm_keyst}`
      }
    })

    const mvlist = response.data?.mvlist || []

    if (!mvlist) {
      throw new Error('not found mvs')
    }

    return {
      data: mvlist.map(formatMvItem),
      more: response.data.hasmore === 1,
      total: response.data.total || 0
    }
  } catch (error) {
    throw error
  }
}

function formatMvItem(mv) {
  // 处理封面图片URL
  let cover = mv.mv_picurl || ''
  if (cover && cover.startsWith('http://')) {
    cover = cover.replace('http://', 'https://')
  }

  // 发布时间处理 - Unix时间戳(秒)转为日期字符串
  let publishTime = ''
  if (mv.publish_date) {
    const date = new Date(mv.publish_date * 1000)
    publishTime = date.toISOString().split('T')[0]  // 格式: YYYY-MM-DD
  }

  return {
    id: mv.vid || '',                      // MV视频ID
    name: mv.mv_name || '',                // MV标题
    artistName: mv.singer_name || '',      // 歌手名称
    artistId: mv.singer_mid || '',         // 歌手MID
    cover: cover,                          // 封面图URL
    playCount: Number(mv.playcount || 0),  // 播放次数
    publishTime: publishTime,              // 发布时间
    platform: 'qqmusic'                    // 平台标识
  }
}
