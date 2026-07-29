// 收藏/取消收藏单曲
const getUid = require("../util/getUid")

module.exports = async (query, request) => {
  query.like = query.like == 'false' ? false : true
  if (query.MUSIC_U) {
    query.uid = await getUid(query.MUSIC_U)
  }
  const data = {
    trackId: query.id,
    userid: query.uid,
    like: query.like
  }
  return request(`/api/song/like`, data, {
    crypto: "eapi",
    useCheckToken: false,
    MUSIC_U: query.MUSIC_U
  })
}

