
// QQ音乐 MV 详情接口

const { default: axios } = require('axios')

module.exports = async (query, request) => {
  // 参数验证
  if (!query.mvid) {
    throw new Error('Missing required parameter: id')
  }

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
          'playcnt',
          'isfav',
          'comment_cnt'
        ]
      }
    }
  }

  const mvInfoResponse = await axios.post('https://u.y.qq.com/cgi-bin/musicu.fcg', requestData, {
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1 Edg/131.0.0.0'
      }
    })

  if (!mvInfoResponse.data) {
    throw new Error('MV detail request failed')
  }

  // 解析响应数据
  const mvInfo = mvInfoResponse.data.mvinfo?.data?.[query.mvid]

  if (!mvInfo) {
    throw new Error('MV not found')
  }

  // 返回格式化数据
  return formatMvDetail(mvInfo)
}

/**
 * 格式化 MV 数据
 */
function formatMvDetail(mvInfo) {
  return {
    playCount: mvInfo.playcnt || 0,
    liked: 520,
    commentCount: mvInfo.comment_cnt || 0,
    shareCount: 520,
    likedCount: 520,
    isfav: mvInfo.isfav || 0
  }
}