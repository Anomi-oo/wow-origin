
module.exports = (query, request) => {
  const data = {
    "search_id" : "",
    "uin" : 0
  }

  return request("tencent_musicsoso_hotkey.HotkeyService", "GetHotkeyForQQMusicPC", data, {
    uin: 0,
    qm_keyst: ''
  }).then(res => {
    return res.body.vec_hotkey.map(key => ({
      searchWord: key.title,
      score: key.score,
      content: '',
      source: key.source,
      iconUrl: null,
      iconType: 0
    }))
  })
}
