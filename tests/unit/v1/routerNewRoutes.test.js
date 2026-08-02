const express = require('express')
const request = require('supertest')
const { createWowRouter } = require('aduoer-wow-sdk')

function createService(overrides = {}) {
  return {
    getPlaylists: jest.fn().mockResolvedValue({ items: [], offset: 0, limit: 20, hasMore: false }),
    getPlaylistCategories: jest.fn().mockResolvedValue([{ key: '3317', label: '官方歌单' }]),
    getToplist: jest.fn().mockResolvedValue([]),
    getToplistTracks: jest.fn().mockResolvedValue({ id: '26', name: '热歌榜', tracks: [] }),
    getNewTracks: jest.fn().mockResolvedValue([]),
    getPersonalFM: jest.fn().mockResolvedValue([]),
    getTopArtists: jest.fn().mockResolvedValue([]),
    getArtistDetail: jest.fn().mockResolvedValue({ artist: { id: 'artist-1', name: '歌手' }, tracks: [] }),
    getArtistTracks: jest.fn().mockResolvedValue({ items: [], offset: 0, limit: 50, hasMore: false }),
    getArtistAlbums: jest.fn().mockResolvedValue({ items: [], offset: 0, limit: 50, hasMore: false }),
    getAlbumDetail: jest.fn().mockResolvedValue({ album: { id: 'album-1', name: '专辑' }, tracks: [] }),
    createPlaylist: jest.fn().mockResolvedValue({ id: 'playlist-1', name: '新歌单', description: '', coverUrl: '', trackCount: 0, playCount: 0, favoriteCount: 0, tags: [], creator: { id: 'me', name: '', avatarUrl: '' }, createdAt: null, updatedAt: null }),
    deletePlaylist: jest.fn().mockResolvedValue({ success: true }),
    updatePlaylist: jest.fn().mockResolvedValue({ id: 'playlist-1', name: '新名称', description: '简介', coverUrl: '', trackCount: 0, playCount: 0, favoriteCount: 0, tags: [], creator: { id: 'me', name: '', avatarUrl: '' }, createdAt: null, updatedAt: null }),
    addTrackToPlaylist: jest.fn().mockResolvedValue({ success: true }),
    removeTrack: jest.fn().mockResolvedValue({ success: true }),
    favoritePlaylist: jest.fn().mockResolvedValue({ success: true, status: true }),
    favoriteTrack: jest.fn().mockResolvedValue({ success: true, status: true }),
    getTrackDetail: jest.fn().mockResolvedValue({
      id: 'track-1',
      title: '歌曲',
      artists: [],
      album: { id: 'album-1', name: '专辑', coverUrl: '' },
      durationMs: 1000,
      aliases: [],
      mvId: null,
      favorite: false
    }),
    getSimilarTracks: jest.fn().mockResolvedValue([]),
    getTrackUrl: jest.fn().mockResolvedValue({
      url: 'https://audio.test/song.flac',
      quality: 'lossless',
      format: 'flac',
      bitrate: 1000000,
      size: 123456
    }),
    getTrackLyrics: jest.fn().mockResolvedValue({
      lyrics: '[00:01.00]逐行歌词',
      wordLyrics: '[1000,1000]逐(1000,500)字(1500,500)',
      translatedLyrics: ''
    }),
    ...overrides
  }
}

function createApp(service) {
  const app = express()
  app.use(express.json())
  app.use(createWowRouter({
    resolveContext: () => ({
      adapter: service,
      stateless: false,
      qualityMap: [
        { key: 'standard', label: '标准' },
        { key: 'lossless', label: '无损' }
      ]
    }),
    validateResponses: false
  }))
  return app
}

describe('v1 新增路由', () => {
  test('/v1/metadata/match 已迁移到 aduoer-api', async () => {
    const service = createService()

    await request(createApp(service))
      .post('/v1/metadata/match')
      .send({ fileName: '歌曲.mp3' })
      .expect(404)
  })

  test('createWowRouter 直接提供 /v1 前缀', async () => {
    const service = createService()

    await request(createApp(service))
      .get('/v1/playlist/list')
      .query({ offset: 10, category: '官方歌单' })
      .expect(200)

    await request(createApp(service))
      .get('/playlist/list')
      .expect(404)
  })

  test('/v1/playlist/list 支持可选 category 参数', async () => {
    const service = createService()

    await request(createApp(service))
      .get('/v1/playlist/list')
      .query({ offset: 10, limit: 20, category: '3317' })
      .expect(200)

    expect(service.getPlaylists).toHaveBeenCalledWith(10, 20, '3317')
  })

  test('新增榜单与分类路由已挂载', async () => {
    const service = createService()
    const app = createApp(service)

    await request(app).get('/v1/playlist/category').expect(200)
    await request(app).get('/v1/toplist/list').expect(200)
    await request(app).get('/v1/toplist/detail').query({ id: '26' }).expect(200)
    await request(app).get('/v1/track/new').expect(200)
    await request(app).get('/v1/artist/top').expect(200)

    expect(service.getPlaylistCategories).toHaveBeenCalled()
    expect(service.getToplist).toHaveBeenCalled()
    expect(service.getToplistTracks).toHaveBeenCalledWith('26', 0, 100)
    expect(service.getNewTracks).toHaveBeenCalled()
    expect(service.getTopArtists).toHaveBeenCalled()
  })

  test('/v1/track/fm 是私人 FM 入口，旧 /v1/track/personal-fm 已删除', async () => {
    const service = createService()
    const app = createApp(service)

    await request(app).get('/v1/track/fm').expect(200)
    await request(app).get('/v1/track/personal-fm').expect(404)

    expect(service.getPersonalFM).toHaveBeenCalledTimes(1)
  })

  test('艺人和专辑详情路由使用 query id，不再使用路径参数', async () => {
    const service = createService()
    const app = createApp(service)

    await request(app).get('/v1/artist/detail?id=artist-1').expect(200)
    await request(app).get('/v1/artist/tracks?id=artist-1&order=hot&offset=2&limit=30').expect(200)
    await request(app).get('/v1/artist/albums?id=artist-1&offset=3&limit=10').expect(200)
    await request(app).get('/v1/album/detail?id=album-1').expect(200)

    await request(app).get('/v1/artist/artist-1/tracks').expect(404)
    await request(app).get('/v1/artist/artist-1/albums').expect(404)

    expect(service.getArtistDetail).toHaveBeenCalledWith('artist-1', -1)
    expect(service.getArtistTracks).toHaveBeenCalledWith('artist-1', 'hot', 2, 30)
    expect(service.getArtistAlbums).toHaveBeenCalledWith('artist-1', 3, 10)
    expect(service.getAlbumDetail).toHaveBeenCalledWith('album-1', -1)
  })

  test('/v1/track 是歌曲详情唯一入口，旧 /v1/song 已删除', async () => {
    const service = createService()
    const app = createApp(service)

    await request(app).get('/v1/track?id=track-1').expect(200)
    await request(app).get('/v1/song?id=track-1').expect(404)

    expect(service.getTrackDetail).toHaveBeenCalledTimes(1)
    expect(service.getTrackDetail).toHaveBeenCalledWith('track-1')
  })

  test('/v1/track/similar 使用歌曲 id 获取相似歌曲', async () => {
    const service = createService()
    const app = createApp(service)

    await request(app).get('/v1/track/similar?id=track-1').expect(200)
    await request(app).get('/v1/track/similar').expect(400)

    expect(service.getSimilarTracks).toHaveBeenCalledTimes(1)
    expect(service.getSimilarTracks).toHaveBeenCalledWith('track-1')
  })

  test('歌曲地址与歌词路由分别返回 TrackUrl 和 TrackLyrics', async () => {
    const service = createService()
    const app = createApp(service)

    const audioResponse = await request(app)
      .get('/v1/track/url?id=track-1&quality=lossless')
      .expect(200)
    const lyricResponse = await request(app)
      .get('/v1/track/lyrics?id=track-1')
      .expect(200)

    expect(service.getTrackUrl).toHaveBeenCalledWith('track-1', 'lossless')
    expect(service.getTrackLyrics).toHaveBeenCalledWith('track-1')
    expect(audioResponse.body.data).toEqual({
      url: 'https://audio.test/song.flac',
      quality: 'lossless',
      format: 'flac',
      bitrate: 1000000,
      size: 123456
    })
    expect(lyricResponse.body.data).toEqual({
      lyrics: '[00:01.00]逐行歌词',
      wordLyrics: '[1000,1000]逐(1000,500)字(1500,500)',
      translatedLyrics: ''
    })
  })

  test('歌曲地址与歌词路由缺少 id 时返回 400', async () => {
    const service = createService()
    const app = createApp(service)

    await request(app).get('/v1/track/url').expect(400)
    await request(app).get('/v1/track/lyrics').expect(400)
    expect(service.getTrackUrl).not.toHaveBeenCalled()
    expect(service.getTrackLyrics).not.toHaveBeenCalled()
  })

  test('旧歌词地址永久重定向到新地址', async () => {
    const service = createService()
    const response = await request(createApp(service))
      .get('/v1/track/lyric?id=track-1')
      .expect(308)

    expect(response.headers.location).toBe('/v1/track/lyrics?id=track-1')
    expect(service.getTrackLyrics).not.toHaveBeenCalled()
  })

  test('歌单写操作路由使用 JSON body 参数', async () => {
    const service = createService()
    const app = createApp(service)

    await request(app).post('/v1/playlist/create').send({ name: '新歌单' }).expect(200)
    await request(app).post('/v1/playlist/update').send({ id: 'playlist-1', name: '新名称', description: '简介' }).expect(200)
    await request(app).post('/v1/playlist/delete').send({ id: 'playlist-1' }).expect(200)
    await request(app).post('/v1/playlist/addTrack').send({ playlistId: 'playlist-1', trackId: 'track-1' }).expect(200)
    await request(app).post('/v1/playlist/removeTrack').send({ playlistId: 'playlist-1', trackId: 'track-1' }).expect(200)

    expect(service.createPlaylist).toHaveBeenCalledWith('新歌单')
    expect(service.updatePlaylist).toHaveBeenCalledWith('playlist-1', '新名称', '简介')
    expect(service.deletePlaylist).toHaveBeenCalledWith('playlist-1')
    expect(service.addTrackToPlaylist).toHaveBeenCalledWith('playlist-1', 'track-1')
    expect(service.removeTrack).toHaveBeenCalledWith('playlist-1', 'track-1')
  })

  test('收藏写操作使用 JSON body 参数并返回当前状态', async () => {
    const service = createService()
    const app = createApp(service)

    const playlistResponse = await request(app)
      .post('/v1/playlist/favorite')
      .send({ id: 'playlist-1', status: true })
      .expect(200)
    const trackResponse = await request(app)
      .post('/v1/track/favorite')
      .send({ id: 'track-1', status: true })
      .expect(200)

    expect(service.favoritePlaylist).toHaveBeenCalledWith('playlist-1', true)
    expect(service.favoriteTrack).toHaveBeenCalledWith('track-1', true)
    expect(playlistResponse.body.data).toEqual({ success: true, status: true })
    expect(trackResponse.body.data).toEqual({ success: true, status: true })
  })

  test('歌单写操作缺少必填参数返回 400', async () => {
    const service = createService()
    const app = createApp(service)

    await request(app).post('/v1/playlist/create').send({ name: '' }).expect(400)
    await request(app).post('/v1/playlist/favorite').send({ id: 'playlist-1', status: 'maybe' }).expect(400)
    await request(app).post('/v1/track/favorite').send({ id: 'track-1', status: 'maybe' }).expect(400)
  })
})
