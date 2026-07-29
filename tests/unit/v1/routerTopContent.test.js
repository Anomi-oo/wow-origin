const express = require('express')
const request = require('supertest')
const { createWowRouter } = require('aduoer-wow-sdk')

function createService(overrides = {}) {
  return {
    getPlaylists: jest.fn().mockResolvedValue({ items: [], offset: 0, limit: 20, hasMore: false }),
    getPlaylistCategories: jest.fn().mockResolvedValue([{ key: '100', label: '全部' }]),
    getToplist: jest.fn().mockResolvedValue([{ name: '榜单', displayType: 'TOP_3', list: [] }]),
    getToplistTracks: jest.fn().mockResolvedValue({ id: '26', name: '热歌榜', tracks: [] }),
    getNewTracks: jest.fn().mockResolvedValue([]),
    getTopArtists: jest.fn().mockResolvedValue([]),
    ...overrides
  }
}

function createApp(service) {
  const app = express()
  app.use(createWowRouter({
    resolveContext: () => ({ adapter: service }),
    validateResponses: false
  }))
  return app
}

describe('v1 top content routes', () => {
  test('/v1/playlist/list forwards optional category', async () => {
    const service = createService()

    const response = await request(createApp(service))
      .get('/v1/playlist/list?offset=5&limit=10&category=3317')
      .expect(200)

    expect(response.body).toMatchObject({ code: 200 })
    expect(service.getPlaylists).toHaveBeenCalledWith(5, 10, '3317')
  })

  test('/v1/playlist/category returns ordered category entries', async () => {
    const service = createService({
      getPlaylistCategories: jest.fn().mockResolvedValue([
        { key: '100', label: '全部' },
        { key: '101', label: '华语' }
      ])
    })

    const response = await request(createApp(service))
      .get('/v1/playlist/category')
      .expect(200)

    expect(response.body.data).toEqual([
      { key: '100', label: '全部' },
      { key: '101', label: '华语' }
    ])
  })

  test('/v1/toplist/detail requires id and forwards pagination', async () => {
    const service = createService()

    await request(createApp(service))
      .get('/v1/toplist/detail')
      .expect(400)

    await request(createApp(service))
      .get('/v1/toplist/detail?id=26&offset=2&limit=30')
      .expect(200)

    expect(service.getToplistTracks).toHaveBeenCalledWith('26', 2, 30)
  })

  test('toplist, new tracks and top artists routes call service', async () => {
    const service = createService()
    const app = createApp(service)

    await request(app).get('/v1/toplist/list').expect(200)
    await request(app).get('/v1/track/new').expect(200)
    await request(app).get('/v1/artist/top').expect(200)

    expect(service.getToplist).toHaveBeenCalled()
    expect(service.getNewTracks).toHaveBeenCalled()
    expect(service.getTopArtists).toHaveBeenCalled()
  })
})
