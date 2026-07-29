const similarTrack = require('../../../platforms/netease/module/similar_track')

describe('网易云相似歌曲模块', () => {
  test('调用 simiSong 接口并默认请求 50 首', async () => {
    const request = jest.fn().mockResolvedValue({ body: { songs: [] } })

    const result = await similarTrack({ id: '123', MUSIC_U: 'music-u' }, request)

    expect(request).toHaveBeenCalledWith(
      '/api/v1/discovery/simiSong',
      { songid: '123', limit: 50, offset: 0 },
      expect.objectContaining({ crypto: 'weapi', MUSIC_U: 'music-u' })
    )
    expect(result).toEqual({ songs: [] })
  })
})
