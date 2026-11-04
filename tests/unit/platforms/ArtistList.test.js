const qqArtists = require('../../../platforms/qqmusic/module/artist_list')
const neteaseArtists = require('../../../platforms/netease/module/artist_list')

describe('artist list upstream pagination', () => {
  function qqRequest(total = 240) {
    return jest.fn(async (_module, _method, { sin }) => ({
      body: { code: 0, req_0: { code: 0, data: {
        total,
        singerlist: Array.from({ length: Math.max(0, Math.min(80, total - sin)) }, (_, i) => ({
          singer_mid: String(sin + i), singer_name: `艺人${sin + i}`
        }))
      } } }
    }))
  }

  test('QQ 任意偏移量及跨上游三页的请求连续且不超过 limit', async () => {
    const request = qqRequest()
    const result = await qqArtists({ offset: 79, limit: 100 }, request)
    expect(result.artists.map(a => a.id)).toEqual(Array.from({ length: 100 }, (_, i) => String(79 + i)))
    expect(result.more).toBe(true)
    expect(request.mock.calls[0][2]).toMatchObject({ area: -100, sex: -100, genre: -100, index: -100 })
  })

  test('QQ 同一上游页内只取所需范围，末页与空页不再继续', async () => {
    const request = qqRequest(95)
    const withinPage = await qqArtists({ offset: 20, limit: 20 }, request)
    expect(withinPage.artists.map(a => a.id)).toEqual(Array.from({ length: 20 }, (_, i) => String(20 + i)))
    expect(request).toHaveBeenCalledTimes(1)
    const last = await qqArtists({ offset: 90, limit: 20 }, request)
    expect(last.artists).toHaveLength(5)
    expect(last.more).toBe(false)
    const empty = await qqArtists({ offset: 100, limit: 20 }, request)
    expect(empty).toEqual({ artists: [], more: false, total: 95 })
  })

  test('QQ 上游业务错误不会被当成空列表', async () => {
    const request = jest.fn().mockResolvedValue({ body: { code: 0, req_0: { code: 500, data: {} } } })
    await expect(qqArtists({ offset: 0, limit: 20 }, request)).rejects.toThrow()
  })

  test('网易请求 artist/list，分类默认全部并保留上游分页状态', async () => {
    const body = { artists: [{ id: 1, name: '艺人' }], more: false }
    const request = jest.fn().mockResolvedValue({ body })
    await expect(neteaseArtists({ offset: 40, limit: 20 }, request)).resolves.toBe(body)
    expect(request).toHaveBeenCalledWith('/api/v1/artist/list', {
      initial: -1, offset: 40, limit: 20, total: true, type: -1, area: -1
    }, expect.objectContaining({ crypto: 'weapi' }))
  })
})
