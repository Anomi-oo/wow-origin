const getPlaylist = require('./playlist_detail')
//每日推荐单曲

module.exports = async (query, request) => {

  const data = {
      "direction": 0,
      "page": 1,
      "v_cache": [],
      "v_uniq": [],
      "s_num": 0
  }

  const response = await request("music.recommend.RecommendFeed", "get_recommend_feed", data, {
    uin: query.uin || 0,
    qm_keyst: query.qm_keyst || ''
  })

  try{
    if (!response.body || response.status !== 200) {
      throw new Error('Get recommend songs request failed')
    }

    // 筛选title为"每日30首"的卡片并获取其id
    const vCard = response.body.v_shelf?.[0]?.v_niche?.[0]?.v_card || []
    const dailyRecommend = vCard.find(card => card.title === '每日30首')
    const tid = dailyRecommend?.id


    if (!tid) {
      throw new Error('Invalid response structure: unable to extract recommendation id')
    }

    const recommendList = await getPlaylist({
      id: tid,
      uin: query.uin,
      qm_keyst: query.qm_keyst
    },
    request
  )

    return formatRecommendSongs(recommendList.playlist)
  } catch(error) {
    throw error
  }
}

function formatRecommendSongs(recommendList) {
  return {
    data: {
      dailySongs: recommendList.tracks || []
    }
  }
}