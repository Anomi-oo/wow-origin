const playlistSubscribe = require('../../../platforms/netease/module/playlist_subscribe')

describe('Netease playlist_subscribe module', () => {
  test('将重复收藏 501 转成可供 v1 client 识别的 payload', async () => {
    const request = jest.fn().mockRejectedValue({
      status: 501,
      body: { code: 501 }
    })

    await expect(playlistSubscribe({ id: '987', t: 1, MUSIC_U: 'music-u' }, request))
      .resolves
      .toEqual({ data: { code: 501 } })
  })

  test('非 501 错误继续抛出', async () => {
    const error = {
      status: 502,
      body: { code: 502 }
    }
    const request = jest.fn().mockRejectedValue(error)

    await expect(playlistSubscribe({ id: '987', t: 1, MUSIC_U: 'music-u' }, request))
      .rejects
      .toBe(error)
  })
})
