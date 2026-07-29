// 搜索建议
const { default: axios } = require('axios')

module.exports = async (query, request) => {

  const keywords = query.keywords || ''
  const url = `https://c6.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg?_=${Date.now()}&cv=4747474&ct=24&format=json&inCharset=utf-8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=1&uin=0&g_tk_new_20200303=5381&g_tk=5381&hostUin=0&is_xml=0&key=${keywords}`

  try {
    const response = await axios.get(url, {
      timeout: 10000,
      headers: {
        'Referer': 'https://y.qq.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0'
      }
    })

    return formatSuggestResult(response.data.data)
  } catch (error) {
    throw error
  }
}

function formatSuggestResult(data) {
  // 先处理各个类型的数据
  const songs = data.song?.itemlist?.map(item => ({
    id: item.id,
    mid: item.mid,
    name: item.name,
    artist: { name: item.singer || '' },
    platform: 'qqmusic'
  })) || [];

  const artists = data.singer?.itemlist?.map(item => ({
    id: item.mid,  // 歌手使用 mid 作为 id
    name: item.name,
    platform: 'qqmusic'
  })) || [];

  const albums = data.album?.itemlist?.map(item => ({
    id: item.id,
    mid: item.mid,
    name: item.name,
    artist: { name: item.singer || '' },
    platform: 'qqmusic'
  })) || [];

  const mv = data.mv?.itemlist?.map(item => ({
    id: item.vid,  // MV 使用 vid 作为 id
    name: item.name,
    artist: { name: item.singer || '' },
    platform: 'qqmusic'
  })) || [];

  // 动态生成 order 数组，只包含有数据的类型
  const order = [];
  if (songs.length > 0) order.push('songs');
  if (artists.length > 0) order.push('artists');
  if (albums.length > 0) order.push('albums');
  if (mv.length > 0) order.push('mv');

  return {
    result: {
      order,
      songs,
      artists,
      albums,
      mv
    }
  };
}