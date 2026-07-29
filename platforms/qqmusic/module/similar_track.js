// 相似歌曲

const { formatSongs } = require('./song_detail')

module.exports = async (query, request) => {
  const songId = Number(query.id)
  if (!Number.isSafeInteger(songId) || songId <= 0) {
    throw new Error('Missing song id')
  }

  const response = await request(
    'rcmusic.similarSongRadioServer',
    'get_simsongs',
    { songid: songId },
    {
      uin: query.uin || 0,
      qm_keyst: query.qm_keyst || ''
    }
  )
  const songs = response.body?.songInfoList || response.body?.data?.songInfoList || []
  return formatSongs(songs)
}
