// QQ音乐排行榜列表
const { default: axios } = require('axios')
const Logger = require('../../../core/Logger')
const logger = new Logger({ component: 'qqmusic-toplist' })

/**
 * 获取所有排行榜列表
 */
module.exports = async (query, request) => {
  logger.debug('QQMusic toplist request')

  // QQ音乐排行榜列表API
  const url = 'https://c.y.qq.com/v8/fcg-bin/fcg_myqq_toplist.fcg?' +
    'g_tk=5381&inCharset=utf-8&outCharset=utf-8&notice=0&format=json&uin=0&needNewCode=1&platform=h5'

  try {
    const response = await axios.get(url, {
      timeout: 10000,
      headers: {
        'Referer': 'https://y.qq.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0'
      }
    })

    const data = response.data

    logger.debug('QQMusic toplist response', {
      code: data?.code,
      hasTopList: !!data?.data?.topList
    })

    if (!data || !data.data || !data.data.topList) {
      throw new Error('Invalid toplist response')
    }

    // 格式化排行榜列表（核心字段）
    // 真实API字段: id, listenCount, picUrl, songList, topTitle, type
    const toplists = data.data.topList.map(item => ({
      id: item.id,
      name: item.topTitle,
      coverUrl: item.picUrl,
      playCount: item.listenCount || 0,
      bookCount: 0,  // QQ音乐无此字段，设为默认值
      trackCount: 0,  // QQ音乐无此字段，设为默认值
      description: '',  // QQ音乐无此字段，设为默认值
      updateFrequency: '',  // QQ音乐无此字段，设为默认值
      updateTime: 0,  // QQ音乐无此字段，设为默认值
      // 歌曲预览列表
      songList: (item.songList || []).slice(0, 3).map(song => ({
        songname: song.songname,
        singername: song.singername
      }))
    }))

    return {
      toplists,
      total: toplists.length
    }

  } catch (error) {
    logger.error('QQMusic toplist failed', {
      error: error.message
    })

    throw error
  }
}