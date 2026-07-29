// 歌曲音质详情

module.exports = (query, request) => {
  const data = {
    songId: query.id,
  }
  return {
    data: {
      songId: query.id,
    }
  }
}
