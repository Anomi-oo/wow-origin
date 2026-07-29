// 歌曲链接

module.exports = async (query, request) => {

  const id = String(query.id || '').split(',').filter(Boolean)
  const data = {
    ids: id,
    level: query.level || 'exhigh',
    encodeType: query.en || query.encodeType || 'flac'
  }

  return request(`/api/song/enhance/player/url/v1`, data, {
    crypto: 'eapi',
    useCheckToken: false,
    MUSIC_U: query.MUSIC_U || ''
  }).then(res => {
    // console.log('song_url_v1 res.body', JSON.stringify(res, null, 2))
    // 将音频URL的HTTP协议转换为HTTPS（避免混合内容警告）
    if (res.body && res.body.data && Array.isArray(res.body.data)) {
      res.body.data = res.body.data.map(item => {
        if (item.url && typeof item.url === 'string' && item.url.startsWith('http://')) {
          item.url = item.url.replace('http://', 'https://')
        }
        return item
      })
    }
    return res.body
  })
}
