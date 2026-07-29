// 点赞与取消点赞资源
const { getResourceTypeMap } = require('../config')

module.exports = (query, request) => {
  query.t = query.t == 1 ? 'like' : 'unlike'
  query.type = getResourceTypeMap()[query.type]
  const data = {
    threadId: query.type + query.id,
  }
  if (query.type === 'A_EV_2_') {
    data.threadId = query.threadId
  }
  return request(`/api/resource/${query.t}`, data, { 
    crypto: 'weapi', 
    useCheckToken: false, 
    MUSIC_U: query.MUSIC_U || '' 
  }).then(res => {
    return res.body
  })
}
