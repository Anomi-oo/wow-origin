const { getResourceTypeMap } = require('../config')
// 热门评论

module.exports = (query, request) => {
  query.type = getResourceTypeMap()[query.type]
  const data = {
    rid: query.id,
    limit: query.limit || 20,
    offset: query.offset || 0,
    beforeTime: query.before || 0,
  }
  return request(`/api/v1/resource/hotcomments/${query.type}${query.id}`, data, { 
    crypto: 'weapi', 
    useCheckToken: false, 
    MUSIC_U: '' 
  }).then(res => {
    return res.body
  })
}
