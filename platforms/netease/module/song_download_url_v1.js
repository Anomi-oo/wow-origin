// 获取客户端歌曲下载链接 - v1
// 此版本不再采用 br 作为音质区分的标准
// 而是采用 standard, exhigh, lossless, hires, jyeffect(高清环绕声), sky(沉浸环绕声), jymaster(超清母带) 进行音质判断

module.exports = (query, request) => {
  const data = {
    id: query.id,
    immerseType: 'c51',
    level: query.level,
  }
  return request(`/api/song/enhance/download/url/v1`, data, {
    crypto: "eapi",
    useCheckToken: false,
    MUSIC_U: query.MUSIC_U || ''
  }).then(res => {
    return res.body
  })
}
