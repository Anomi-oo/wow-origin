//根据MUSIC_U获取用户UID，也可判断MUSIC_U是否过期

const { default: axios } = require("axios")

module.exports = async (MUSIC_U) => {
  const url = 'https://music.163.com/discover/g/attr'
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
    'Referer': 'https://music.163.com/',
    'Cookie': `MUSIC_U=${MUSIC_U}`
  }

  try {
    const response = await axios.get(url, {
      timeout: 10000,
      headers
    })

    if (!response.data || !response.data.g_visitor || !response.data.g_visitor.userId) {
      throw new Error('MUSIC_U is invalid or expired')
    }

    return response.data.g_visitor.userId
  } catch (error) {
    if (error.message.includes('MUSIC_U is invalid')) {
      throw error
    }
    throw new Error(`Failed to get uid: ${error.message}`)
  }
}