const { decryptQrc } = require('qrc-decoder')
const getSongDetail = require('./song_detail')

/**
 * 获取并解码 QQ 音乐 QRC 逐字歌词。
 *
 * 上游在 qrc=1 时返回十六进制密文；解密结果是 XML，真正歌词位于 LyricContent 属性。
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
    qrc: 1
  }, {
    uin: query.uin || 0,
    qm_keyst: query.qm_keyst || ''
  })

  const body = response.body || response
  if (body.qrc !== 1 || typeof body.lyric !== 'string' || !body.lyric) {
    return { yrc: { version: 0, lyric: '' } }
  }

  const decrypted = decryptQrc(body.lyric)
  return {
    yrc: {
      version: Number(body.qrc_t) || 0,
      lyric: extractLyricContent(decrypted)
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

function extractLyricContent(value) {
  const match = /<Lyric_1\b[^>]*\bLyricContent="([\s\S]*?)"\s*\/>/.exec(value)
  if (!match) return ''

  return decodeXmlEntities(match[1]).trim()
}

function decodeXmlEntities(value) {
  return value.replace(/&(?:#(\d+)|#x([\da-f]+)|quot|apos|lt|gt|amp);/gi, (entity, decimal, hexadecimal) => {
    if (decimal) return String.fromCodePoint(Number(decimal))
    if (hexadecimal) return String.fromCodePoint(Number.parseInt(hexadecimal, 16))

    return {
      '&quot;': '"',
      '&apos;': "'",
      '&lt;': '<',
      '&gt;': '>',
      '&amp;': '&'
    }[entity.toLowerCase()] || entity
  })
}

module.exports.extractLyricContent = extractLyricContent
