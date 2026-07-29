// 歌手分类列表
// QQ音乐平台实现

const { default: axios } = require('axios')

/**
 * QQ音乐歌手列表接口
 *
 * 参数说明（前端已处理映射，后端直接接收QQ音乐格式参数）：
 * - type: -100(全部), 0(男), 1(女), 2(组合)
 * - area: -100(全部), 200(内地), 2(港台), 5(欧美), 4(日本), 3(韩国), 6(其他)
 * - initial: -100(热门), 1-26(A-Z), 27(#)
 * - genre: -100(全部), 1(流行), 2(摇滚), 3(民谣), 等... (QQ音乐特有)
 */
module.exports = (query, request) => {
  // ========== 参数处理 ==========

  // 基础参数（直接使用前端传入的QQ音乐格式参数）
  const sex = parseInt(query.type ?? -100)      // type -> sex
  const area = parseInt(query.area ?? -100)
  const index = parseInt(query.initial ?? -100) // initial -> index
  const genre = parseInt(query.genre ?? -100)   // QQ音乐特有的流派参数

  // 分页参数
  const limit = Math.min(parseInt(query.limit) || 80, 100) // 限制最大100
  const offset = parseInt(query.offset) || 0
  const sin = offset                               // QQ音乐使用sin表示偏移量
  const cur_page = Math.floor(offset / limit) + 1  // 当前页码（从1开始）

  // ========== 构建请求数据 ==========

  const requestData = {
    comm: {
      cv: 0,
      ct: 20
    },
    singerList: {
      module: "Music.SingerListServer",
      method: "get_singer_list",
      param: {
        area: area,
        sex: sex,
        genre: genre,
        index: index,
        sin: sin,
        cur_page: cur_page
      }
    }
  }

  // 构建完整URL（使用GET请求）
  const baseUrl = 'https://u.y.qq.com/cgi-bin/musicu.fcg'

  // 手动构建URL参数，不使用URLSearchParams以避免过度编码
  const queryParams = {
    g_tk: '5381',
    loginUin: '',
    hostUin: '0',
    format: 'json',
    inCharset: 'GB2312',
    outCharset: 'GB2312',
    notice: '0',
    platform: 'pcweb',
    needNewCode: '0',
    data: JSON.stringify(requestData)
  }

  // 手动拼接URL，对data参数使用encodeURIComponent
  const url = `${baseUrl}?g_tk=${queryParams.g_tk}&loginUin=${queryParams.loginUin}&hostUin=${queryParams.hostUin}&format=${queryParams.format}&inCharset=${queryParams.inCharset}&outCharset=${queryParams.outCharset}&notice=${queryParams.notice}&platform=${queryParams.platform}&needNewCode=${queryParams.needNewCode}&data=${encodeURIComponent(queryParams.data)}`

  // ========== 发送请求 ==========

  return axios.get(url, {
    timeout: 10000,
    headers: {
      'Referer': 'https://y.qq.com/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    }
  }).then(response => {
    // 检查响应
    if (!response.data || response.data.code !== 0) {
      throw new Error(response.data?.message || 'QQ Music API error')
    }

    // 提取歌手列表数据
    const singerListData = response.data.singerList?.data || {}
    const singerlist = singerListData.singerlist || []
    const total = singerListData.total || 0

    // ========== 格式化响应数据 ==========

    return {
      artists: singerlist.map(formatArtist),
      more: (offset + limit) < total,
      total: total
    }

  }).catch(error => {
    // 错误处理
    if (error.response) {
      throw new Error(`QQ Music API error: ${error.response.status}`)
    } else if (error.request) {
      throw new Error('QQ Music API network error')
    } else {
      throw error
    }
  })
}

/**
 * 格式化歌手数据为统一格式
 * @param {Object} singer - QQ音乐原始歌手数据
 * @returns {Object} 格式化后的歌手数据
 */
function formatArtist(singer) {
  const singerMid = singer.singer_mid || singer.singerMID || ''
  const singerPic = singer.singer_pic || singer.singerPic || ''

  return {
    // 基础信息
    id: singerMid,
    name: singer.singer_name || singer.singerName || '',

    // 图片信息（优先使用API返回的图片，否则根据mid生成）
    picUrl: singerPic || (singerMid ? `https://y.gtimg.cn/music/photo_new/T001R300x300M000${singerMid}.jpg` : ''),
    img1v1Url: singerPic || (singerMid ? `https://y.gtimg.cn/music/photo_new/T001R300x300M000${singerMid}.jpg` : ''),

    // 别名
    alias: [],

    // 统计信息
    albumSize: 0,
    mvSize: 0,

    // 平台标识
    platform: "qqmusic"
  }
}
