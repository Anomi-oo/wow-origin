// 收藏单曲到歌单 从歌单删除歌曲

module.exports = async (query, request) => {

  const tracks = query.tracks.split(',')
  const data = {
    op: query.op, // del,add
    pid: query.pid, // 歌单id
    trackIds: JSON.stringify(tracks), // 歌曲id
    imme: 'true',
  }

  try {
    const res = await request(`/api/playlist/manipulate/tracks`, data, {
      crypto: "eapi",
      useCheckToken: false,
      MUSIC_U: query.MUSIC_U
    })
    return {
      status: 200,
      body: {
        ...res.body,
      },
    }
  } catch (error) {
    if (error.body.code === 512) {
      return request(
        `/api/playlist/manipulate/tracks`,
        {
          op: query.op, // del,add
          pid: query.pid, // 歌单id
          trackIds: JSON.stringify([...tracks, ...tracks]),
          imme: 'true',
        },
        {
          crypto: "eapi",
          useCheckToken: false,
          MUSIC_U: query.MUSIC_U
       },
      ).then (res => {
        return res.body
      })
    } else {
      return {
        status: 200,
        body: error.body,
      }
    }
  }
}
