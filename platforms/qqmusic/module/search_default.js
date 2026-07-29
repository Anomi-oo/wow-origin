// 默认搜索关键词,平台缺少接口

module.exports = (query, request) => {
  return {
    data: {
      showKeyword: '搜索音乐',
      realkeyword: '搜索音乐'
    }
  }
}
