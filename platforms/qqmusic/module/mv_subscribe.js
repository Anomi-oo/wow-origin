// 收藏/取消收藏MV

module.exports = (query, request) => {
  // t=1 收藏, t=0 取消收藏
  const reqtype = query.t == 1 ? 1 : 0

  const data = {
    uin: query.uin,
    cmdtype: 0,
    reqtype: reqtype,
    mvidtype: 0,
    mvidlist: query.id  // MV的ID，如 "m001932sz04"
  }

  return request('music.musicasset.MVFavWrite', 'AddDelFavMV', data, {
    uin: query.uin,
    qm_keyst: query.qm_keyst
  })
}
