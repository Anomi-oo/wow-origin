const { QQClient } = require('../../../dist/clients/QQClient')
const { NeteaseClient } = require('../../../dist/clients/NeteaseClient')
const { collectionStatusNeeded } = require('../../../dist/collectionStatus')

describe('v1 artist list platform adapters', () => {
  afterEach(() => { delete global.__musicPlatformFactory__ })

  test.each([
    ['QQ', QQClient, { type: -100, area: -100, initial: -100, genre: -100 }],
    ['网易', NeteaseClient, { type: -1, area: -1, initial: -1 }]
  ])('%s 列表只传分页与全部分类，映射收藏及末页状态', async (_name, Client, filters) => {
    const callModule = jest.fn().mockResolvedValue({ code: 200, body: { artists: [{ id: '1', name: '艺人', picUrl: 'https://example.com/cover.jpg' }], more: false } })
    global.__musicPlatformFactory__ = { getPlatform: () => ({ callModule }) }
    const adapter = new Client('', undefined, new Set(['1']))
    expect(await adapter.getArtists(79, 100)).toEqual({
      items: [{ id: '1', name: '艺人', coverUrl: 'https://example.com/cover.jpg', favorite: true }],
      offset: 79, limit: 100, hasMore: false
    })
    expect(callModule).toHaveBeenCalledWith('artist/list', expect.objectContaining({
      query: expect.objectContaining({ offset: 79, limit: 100, ...filters })
    }))
    expect(collectionStatusNeeded('/artist/list').artists).toBe(true)
  })
})
