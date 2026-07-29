module.exports = async (query, request) => {
  const uin = String(query.uin || query.uid || '').replace(/^o/, '')

  if (!uin || uin === '0') {
    throw new Error('uin is required')
  }

  const data = {
    vec_uin: [uin]
  }

  const response = await request("userInfo.BaseUserInfoServer", "get_user_baseinfo_v2", data, {
    uin,
    qm_keyst: query.qm_keyst || ''
  })

  // 提取用户信息（QQ音乐返回的是map结构，取第一个用户）
  const userInfo = response.body.map_userinfo ? response.body.map_userinfo[query.uin] : null

  if (!userInfo) {
    throw new Error('User not found')
  }

  // 格式化为与网易云对齐的核心字段
  return {
    userId: Number(userInfo.uin),
    userType: 0,
    vipType: 11,
    nickname: userInfo.nick,
    level: 0,
    avatarUrl: userInfo.headurl,
    backgroundUrl: userInfo.ifpicurl,
    createTime: 0
  }
}
