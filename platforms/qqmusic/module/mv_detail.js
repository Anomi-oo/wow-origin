// QQ音乐 MV 详情接口

const { default: axios } = require('axios')
const mvUrlModule = require('./mv_url')

module.exports = async (query, request) => {
  // 参数验证
  if (!query.mvid) {
    throw new Error('Missing required parameter: id')
  }

  let uin = query.uin || '0' // QQ音乐用户uin
  let qm_keyst = query.qm_keyst || '' // QQ音乐VIP认证信息

  const requestData = {
    comm: {
      ct: 24,
      cv: 4747474
    },
    mvinfo: {
      module: 'video.VideoDataServer',
      method: 'get_video_info_batch',
      param: {
        vidlist: [query.mvid],
        required: [
          'vid',
          'type',
          'sid',
          'cover_pic',
          'duration',
          'singers',
          'video_switch',
          'msg',
          'name',
          'desc',
          'playcnt',
          'pubdate',
          'isfav',
          'gmid'
        ]
      }
    }
  }

  // 并行执行两个请求
  const [mvInfoResponse, mvUrlData] = await Promise.all([
    axios.post('https://u.y.qq.com/cgi-bin/musicu.fcg', requestData, {
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1 Edg/131.0.0.0'
      }
    }),
    mvUrlModule({ id: query.mvid, r: 240, uin: uin, qm_keyst: qm_keyst }, request).catch(error => {
      console.log('Failed to get brs from mv_url:', error.message)
      return { brs: [] }
    })
  ])

  if (!mvInfoResponse.data) {
    throw new Error('MV detail request failed')
  }

  // 解析响应数据
  const mvInfo = mvInfoResponse.data.mvinfo?.data?.[query.mvid]

  if (!mvInfo) {
    throw new Error('MV not found')
  }

  // 返回格式化数据
  return formatMvDetail(mvInfo, mvUrlData.data.brs || [])
}

/**
 * 格式化 MV 详情数据
 */
function formatMvDetail(mvInfo, brs) {
  const singers = Array.isArray(mvInfo.singers) ? mvInfo.singers : []
  const primarySinger = singers[0] || {}

  return {
    data: {
      id: mvInfo.vid,
      name: mvInfo.name,
      desc: mvInfo.desc || '',
      artistId: primarySinger.id || 0,
      artistName: primarySinger.name || '',
      artists: singers.map(s => ({
        id: s.mid,
        //mid: s.mid,
        name: s.name,
        picUrl: s.picUrl || ''
      })),
      cover: mvInfo.cover_pic || '',
      duration: (mvInfo.duration || 0) * 1000,
      playCount: mvInfo.playcnt || 0,
      publishTime: new Date(Number(mvInfo.pubdate) * 1000).toISOString().split('T')[0] || '',
      isFavorite: mvInfo.isfav || 0,
      gmid: mvInfo.gmid || '',
      brs: brs,
      platform: 'qqmusic'
    }
  }
}
