// 用户详情
const getUid = require("../util/getUid")

module.exports = async (query, request) => {

  if (query.MUSIC_U) {
    query.uid = await getUid(query.MUSIC_U)
  }

  const res = await request( `/api/v1/user/detail/${query.uid}`, {}, {
      crypto: 'weapi',
      useCheckToken: false,
      MUSIC_U: query.MUSIC_U || ''
  })
  const result = JSON.stringify(res).replace(
    /avatarImgId_str/g,
    'avatarImgIdStr',
  )
  return formatUserDetail(JSON.parse(result).body)
}

function formatUserDetail(userData) {
  return {
    userId: userData.profile.userId,
    userType: userData.profile.userType,
    vipType: userData.profile.vipType,
    nickname: userData.profile.nickname,
    level: userData.level,
    avatarUrl: userData.profile.avatarUrl,
    backgroundUrl: userData.profile.backgroundUrl,
    createTime: userData.profile.createTime
  }
}