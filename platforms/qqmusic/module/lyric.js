const getSongDetail = require('./song_detail')

/**
 * 获取 QQ 音乐逐行歌词。
 *
 * PlayLyricInfo 在 qrc=0 时返回 Base64 编码的标准 LRC；调用方可以传 mid 或数字 id。
 */
module.exports = async (query, request) => {
  const songId = await resolveSongId(query, request)
  const response = await request('music.musichallSong.PlayLyricInfo', 'GetPlayLyricInfo', {
    crypt: 0,
    roma: 0,
    roma_t: 0,
    songID: songId,
    trans: 0,
    trans_t: 0,
    type: 0,
    qrc: 0
  }, {
    uin: query.uin || 0,
    qm_keyst: query.qm_keyst || ''
  })

  const body = response.body || response
  return {
    lrc: {
      version: Number(body.lrc_t) || 0,
      lyric: decodeBase64(body.lyric)
    }
  }
}

async function resolveSongId(query, request) {
  if (query.id && /^\d+$/.test(String(query.id))) {
    return Number(query.id)
  }

  const detail = await getSongDetail({
    mid: query.mid || query.id,
    uin: query.uin,
    qm_keyst: query.qm_keyst
  }, request)
  const songId = detail.songs?.[0]?.id
  if (!songId) throw new Error('Missing song id')
  return Number(songId)
}

function decodeBase64(value) {
  if (typeof value !== 'string' || !value) return ''
  return Buffer.from(value, 'base64').toString('utf8')
}
