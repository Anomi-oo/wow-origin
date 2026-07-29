// 收藏/取消收藏歌单

module.exports = async (query, request) => {
  const path = query.t == 1 ? 'subscribe' : 'unsubscribe'
  const data = {
    id: query.id
  }
  return request(`/api/playlist/${path}`, data, {
    crypto: "eapi",
    useCheckToken: false,
    MUSIC_U: query.MUSIC_U
  }).then(res => {
    return res.body
  }).catch(error => {
    if (Number(error?.status) === 501 || Number(error?.body?.code) === 501) {
      return { data: { code: 501 } }
    }
    throw error
  })
}
