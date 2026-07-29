// QQ音乐 MV 播放地址获取接口

module.exports = async (query, request) => {
  if (!query.id) {
    throw new Error('Missing required parameter: id')
  }

  const r = parseInt(query.r) || 1080

  const uin = query.uin || '0' // QQ音乐用户uin
  const qm_keyst = query.qm_keyst || '' // QQ音乐VIP认证信息

  // 调用 QQ 音乐 API
  const response = await request("gosrf.Stream.MvUrlProxy", "GetMvUrls", {
    vids: [query.id],
    request_type: 10001
  }, {
    uin: uin,
    qm_keyst: qm_keyst
  })

  const videoData = response.body?.[query.id]
  if (!videoData) {
    throw new Error('MV not found or unavailable')
  }

  // 分辨率映射表
  const resolutionMap = {
    0: 144,    // 试看
    10: 240,   // 标清
    20: 480,   // 高清
    30: 720,   // 超清
    40: 1080,  // 蓝光
    50: 1080   // 4K
  }

  // 辅助函数：从 freeflow_url 数组中提取最优URL
  
  const extractUrl = (urlList) => {
    if (!urlList || !Array.isArray(urlList)) return ''
    return urlList.find(u => u.startsWith('https://')) ||
           urlList.find(u => u.startsWith('http://')) || ''
  }

  // 第一步：生成所有可用分辨率列表（包含URL字段）
  const mp4List = videoData.mp4 || []
  const brs = mp4List
    .filter(item => item.code === 0)
    .map(item => ({
      size: item.fileSize || 0,
      br: resolutionMap[item.filetype],
      point: 0,
      url: extractUrl(item.freeflow_url) || ''
    }))
    .sort((a, b) => a.br - b.br)

  // 第二步：根据参数 r 从 brs 列表中选择要返回的URL
  const matched = brs.find(item => item.br === r)

  // 如果没有找到匹配的分辨率
  if (!matched) {
    throw new Error(`Requested resolution ${r}p not available`)
  }

  // 找到匹配的分辨率，返回对应的播放地址
  return {
    data:{
      id: query.id,
      url: matched.url,
      r: matched.br,
      size: matched.size,
      md5: '',
      code: 200,
      expi: videoData.expi || 3600,
      fee: 0,
      mvFee: 0,
      st: 0,
      promotionVo: null,
      msg: '',
      brs: brs
    }
  }
}
