const { getAndroidLoginContext } = require('../util/android-login')

// Match QQMusicApi's Android songlist write request and response rule.
module.exports = async (query) => {
  const musicid = String(query.musicid || query.uin || '').replace(/^o/, '')
  const musickey = query.musickey || query.qm_keyst
  const songIds = String(query.id ?? query.ids ?? '').split(',').map(Number)
  if (!/^[1-9]\d*$/.test(musicid) || !musickey || songIds.some(id => !Number.isSafeInteger(id) || id <= 0)) {
    throw new Error('QQ 歌曲收藏参数不完整')
  }
  const method = query.like === false || query.like === 'false' ? 'DelSonglist' : 'AddSonglist'
  const result = await getAndroidLoginContext(musicid, undefined, { requireExisting: true }).androidLoginCgi(
    'music.musicasset.PlaylistDetailWrite', method,
    { dirId: 201, tid: 0, bFmtUtf8: true, v_songInfo: songIds.map(songId => ({ songId, songType: 0 })) },
    { musicid, musickey, loginType: Number(query.loginType ?? 2) }
  )
  return { ...result.data, success: result.code === 0 && result.data?.retCode === 0, code: result.code }
}
