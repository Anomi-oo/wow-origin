const { NeteaseClient } = require('../../../dist/clients/NeteaseClient')
const express = require('express')
const request = require('supertest')
const { createWowRouter } = require('aduoer-wow-sdk')

function createTrackUrlApp(client) {
  const app = express()
  app.use(createWowRouter({
    resolveContext: async () => ({
      adapter: client,
      stateless: false,
      qualityMap: [{ key: 'master', label: '超清母带' }]
    }),
    validateResponses: false
  }))
  return app
}

describe('NeteaseClient', () => {
  beforeEach(() => {
    global.__musicPlatformFactory__ = {
      getPlatform: jest.fn(() => ({ callModule: jest.fn() }))
    }
  })

  afterEach(() => {
    delete global.__musicPlatformFactory__
  })

  test('getTrackDetail 合并歌曲音质详情返回新增档位', async () => {
    const callModule = jest.fn((route) => Promise.resolve(route === 'song/detail'
      ? { code: 200, songs: [{ id: 123, name: '歌曲', ar: [], al: {}, sq: { size: 100 } }] }
      : { code: 200, data: { songId: 123, jm: { size: 200 }, je: { size: 300 }, vi: { size: 400 }, sks: [{ it: 'c51', size: 500 }] } }))
    global.__musicPlatformFactory__.getPlatform.mockReturnValue({ callModule })

    const track = await new NeteaseClient('MUSIC_U=music-u').getTrackDetail('123')

    expect(track.qualities.map(({ key }) => key)).toEqual(['lossless', 'jyeffect', 'sky', 'master'])
    expect(callModule.mock.calls.map(([route]) => route)).toEqual(['song/detail', 'song/music/detail'])
    expect(callModule.mock.calls.map(([, options]) => options.query.MUSIC_U)).toEqual(['music-u', 'music-u'])
  })

  test('歌曲音质详情请求失败时保留基础详情', async () => {
    const callModule = jest.fn((route) => route === 'song/detail'
      ? Promise.resolve({ code: 200, body: { songs: [{ id: 1, name: '歌曲', sq: { size: 100 } }] } })
      : Promise.reject(new Error('quality details unavailable')))
    global.__musicPlatformFactory__.getPlatform.mockReturnValue({ callModule })

    const track = await new NeteaseClient('MUSIC_U=music-u').getTrackDetail('1')

    expect(track.qualities.map(({ key }) => key)).toEqual(['lossless'])
  })

  test('getTrackUrl 使用 XEAPI 模块并映射实际音质', async () => {
    const callModule = jest.fn((route) => {
      if (route === 'lyric') {
        return Promise.resolve({ code: 200, lrc: { lyric: '逐行歌词' } })
      }
      if (route === 'lyric/new') {
        return Promise.resolve({
          code: 200,
          yrc: { lyric: '{"t":0,"c":[{"tx":"作词"}]}\n[0,1000](0,500,0)歌(500,500,0)词' }
        })
      }
      return Promise.resolve({
        code: 200,
        body: {
          data: [
            {
              id: 33418857,
              url: 'https://m701.music.126.net/audio.flac',
              br: 1058275,
              size: 42154117,
              type: 'flac',
              level: 'lossless'
            }
          ],
          code: 200
        }
      })
    })
    global.__musicPlatformFactory__.getPlatform.mockReturnValue({ callModule })

    const client = new NeteaseClient('MUSIC_U=music-u')
    const result = await client.getTrackUrl('33418857', 'lossless')

    expect(result).toMatchObject({
      url: 'https://m701.music.126.net/audio.flac',
      quality: 'lossless',
      format: 'flac',
      bitrate: 1058275,
      size: 42154117
    })
    expect(callModule).toHaveBeenCalledWith('song/url/xeapi', expect.objectContaining({
      query: expect.objectContaining({
        id: '33418857',
        level: 'lossless',
        MUSIC_U: 'music-u',
        platform: 'netease'
      })
    }))
    expect(callModule).not.toHaveBeenCalledWith('lyric', expect.anything())
    expect(callModule).not.toHaveBeenCalledWith('lyric/new', expect.anything())
  })

  test('v1 接口对 QQ 歌曲 MID 返回明确的 400 响应', async () => {
    const callModule = jest.fn()
    global.__musicPlatformFactory__.getPlatform.mockReturnValue({ callModule })

    const response = await request(createTrackUrlApp(new NeteaseClient('')))
      .get('/v1/track/url?id=002DONNN2RB5K6&quality=master')
      .expect(400)

    expect(response.body).toEqual({ code: 400, message: '网易云歌曲 ID 必须为数字', data: null })
    expect(callModule).not.toHaveBeenCalled()
  })

  test('v1 接口对网易音频上游异常返回 502 响应', async () => {
    const callModule = jest.fn().mockResolvedValue({
      code: 500,
      message: 'Unexpected non-whitespace character after JSON'
    })
    global.__musicPlatformFactory__.getPlatform.mockReturnValue({ callModule })

    const response = await request(createTrackUrlApp(new NeteaseClient('')))
      .get('/v1/track/url?id=33418857&quality=master')
      .expect(502)

    expect(response.body).toEqual({ code: 502, message: '获取歌曲链接失败', data: null })
  })

  test('高音质请求返回其他音质时直接使用该链接和实际音质', async () => {
    const callModule = jest.fn((_route, { query }) => Promise.resolve({
      code: 200,
      body: { data: [{ url: `https://audio.example/${query.level}`, level: 'standard' }] }
    }))
    global.__musicPlatformFactory__.getPlatform.mockReturnValue({ callModule })

    await expect(new NeteaseClient('MUSIC_U=music-u').getTrackUrl('33418857', 'master'))
      .resolves.toMatchObject({ url: 'https://audio.example/master', quality: 'standard' })
    expect(callModule.mock.calls.map(([, options]) => options.query.level)).toEqual(['master'])
  })

  test('官方试听链接视为不可用，按歌曲音质表降级到完整链接', async () => {
    const callModule = jest.fn(async (route, { query }) => {
      if (route === 'song/detail') return { code: 200, songs: [{ id: 123, h: { size: 100 }, l: { size: 100 } }] }
      if (route === 'song/music/detail') return { code: 200, data: {} }
      return { code: 200, data: [{
        url: `https://audio.test/${query.level}`,
        level: query.level,
        freeTrialInfo: query.level === 'standard' ? null : { start: 0, end: 30 }
      }] }
    })
    global.__musicPlatformFactory__.getPlatform.mockReturnValue({ callModule })

    await expect(new NeteaseClient('').getTrackUrl('123', 'exhigh')).resolves.toMatchObject({
      url: 'https://audio.test/standard', quality: 'standard'
    })
    expect(callModule.mock.calls.filter(([route]) => route === 'song/url/xeapi').map(([, { query }]) => query.level))
      .toEqual(['exhigh', 'standard'])
    expect(callModule.mock.calls.filter(([route]) => route === 'song/detail')).toHaveLength(1)
  })

  test('所有档位都是试听时不返回试听链接，也不向上选择', async () => {
    const callModule = jest.fn(async (route, { query }) => {
      if (route === 'song/detail') return { code: 200, songs: [{ id: 123, jm: { size: 100 }, h: { size: 100 }, l: { size: 100 } }] }
      if (route === 'song/music/detail') return { code: 200, data: {} }
      return { code: 200, data: [{
        url: `https://audio.test/${query.level}`, level: query.level, freeTrialInfo: { start: 0, end: 30 }
      }] }
    })
    global.__musicPlatformFactory__.getPlatform.mockReturnValue({ callModule })

    await expect(new NeteaseClient('').getTrackUrl('123', 'lossless')).rejects.toThrow('Song only has a trial audio URL')
    expect(callModule.mock.calls.filter(([route]) => route === 'song/url/xeapi').map(([, { query }]) => query.level))
      .toEqual(['lossless', 'exhigh', 'standard'])
    expect(callModule.mock.calls.filter(([route]) => route === 'song/detail')).toHaveLength(1)
  })

  test.each([undefined, null])('完整链接的 freeTrialInfo 为 %s 时不因试听权限字段误判', async (freeTrialInfo) => {
    const callModule = jest.fn().mockResolvedValue({ code: 200, data: [{
      url: 'https://audio.test/full.flac', level: 'lossless', freeTrialInfo,
      freeTrialPrivilege: { resConsumable: false, userConsumable: false }
    }] })
    global.__musicPlatformFactory__.getPlatform.mockReturnValue({ callModule })

    await expect(new NeteaseClient('').getTrackUrl('123', 'lossless')).resolves.toMatchObject({ url: 'https://audio.test/full.flac' })
    expect(callModule).toHaveBeenCalledTimes(1)
  })

  test('高音质、SQ、HQ 均无链接时继续降至标准', async () => {
    const callModule = jest.fn((route, { query }) => {
      if (route === 'song/detail') return Promise.resolve({ code: 200, songs: [{ id: 33418857, sq: { size: 100 }, h: { size: 100 }, l: { size: 100 } }] })
      if (route === 'song/music/detail') return Promise.resolve({ code: 200, data: {} })
      return Promise.resolve({
        code: 200,
        body: { data: [{ url: query.level === 'standard' ? 'https://audio.example/standard' : null, level: query.level }] }
      })
    })
    global.__musicPlatformFactory__.getPlatform.mockReturnValue({ callModule })

    await expect(new NeteaseClient('MUSIC_U=music-u').getTrackUrl('33418857', 'sky'))
      .resolves.toMatchObject({ url: 'https://audio.example/standard', quality: 'standard' })
    expect(callModule.mock.calls.filter(([route]) => route === 'song/url/xeapi').map(([, options]) => options.query.level)).toEqual([
      'sky', 'lossless', 'exhigh', 'standard'
    ])
  })

  test('getTrackLyrics 返回逐行与逐字歌词', async () => {
    const callModule = jest.fn((route) => {
      if (route === 'lyric') {
        return Promise.resolve({
          code: 200,
          lrc: { lyric: '逐行歌词' },
          tlyric: { lyric: '逐行翻译' }
        })
      }
      if (route === 'lyric/new') {
        return Promise.resolve({
          code: 200,
          yrc: { lyric: '{"t":0,"c":[{"tx":"作词"}]}\n[0,1000](0,500,0)歌(500,500,0)词' },
          ytlrc: { lyric: '[0,1000](0,1000,0)翻译' }
        })
      }
      return Promise.resolve({ code: 200 })
    })
    global.__musicPlatformFactory__.getPlatform.mockReturnValue({ callModule })

    const client = new NeteaseClient('MUSIC_U=music-u')
    await expect(client.getTrackLyrics('33418857')).resolves.toEqual({
      lyrics: '逐行歌词',
      wordLyrics: '[0,1000](0,500,0)歌(500,500,0)词',
      translatedLyrics: '逐行翻译'
    })
  })

  test('getTrackLyrics 将网易云暂无歌词占位内容转为 404', async () => {
    const callModule = jest.fn((route) => {
      if (route === 'lyric') {
        return Promise.resolve({
          code: 200,
          lrc: { lyric: '[00:00.00]暂无歌词' }
        })
      }
      if (route === 'lyric/new') {
        return Promise.resolve({ code: 200 })
      }
      return Promise.resolve({ code: 200 })
    })
    global.__musicPlatformFactory__.getPlatform.mockReturnValue({ callModule })

    const client = new NeteaseClient('MUSIC_U=music-u')

    await expect(client.getTrackLyrics('cloud-track-id')).rejects.toMatchObject({
      name: 'NotFoundError',
      status: 404
    })
  })

  test('getSimilarTracks 调用网易云相似歌曲模块并映射歌曲', async () => {
    const callModule = jest.fn().mockResolvedValue({
      code: 200,
      songs: [{ id: 2, name: '相似歌曲', ar: [], al: {} }]
    })
    global.__musicPlatformFactory__.getPlatform.mockReturnValue({ callModule })

    const client = new NeteaseClient('MUSIC_U=music-u')
    const tracks = await client.getSimilarTracks('1')

    expect(callModule).toHaveBeenCalledWith('similar/track', expect.objectContaining({
      query: expect.objectContaining({
        id: '1',
        MUSIC_U: 'music-u',
        platform: 'netease'
      })
    }))
    expect(tracks).toHaveLength(1)
    expect(tracks[0]).toMatchObject({ id: '2', title: '相似歌曲' })
  })

  test('歌单分类从 100 开始并保持固定顺序', async () => {
    const client = new NeteaseClient('MUSIC_U=music-u')
    const categories = await client.getPlaylistCategories()

    expect(categories.slice(0, 6)).toEqual([
      { key: '100', label: '全部' },
      { key: '101', label: '华语' },
      { key: '102', label: '欧美' },
      { key: '103', label: '日语' },
      { key: '104', label: '韩语' },
      { key: '105', label: '粤语' }
    ])
  })

  test('分类歌单将网易云数字 key 映射回 cat label', async () => {
    const callModule = jest.fn().mockResolvedValue({
      code: 200,
      playlists: []
    })
    global.__musicPlatformFactory__.getPlatform.mockReturnValue({ callModule })

    const client = new NeteaseClient('MUSIC_U=music-u')
    await client.getPlaylists(0, 20, '101')

    expect(callModule).toHaveBeenCalledWith('top/playlist', expect.objectContaining({
      query: expect.objectContaining({
        cat: '华语',
        MUSIC_U: 'music-u',
        platform: 'netease'
      })
    }))
  })

  test('无效网易云分类返回空分页且不请求上游', async () => {
    const callModule = jest.fn()
    global.__musicPlatformFactory__.getPlatform.mockReturnValue({ callModule })

    const client = new NeteaseClient('MUSIC_U=music-u')
    const result = await client.getPlaylists(20, 10, '9999')

    expect(result).toEqual({ items: [], offset: 20, limit: 10, hasMore: false })
    expect(callModule).not.toHaveBeenCalled()
  })

  test('getUserPlaylist 将云盘虚拟歌单映射为非本人歌单', async () => {
    const callModule = jest.fn().mockResolvedValue({
      code: 200,
      playlist: [
        { id: 1, name: '我喜欢的音乐', trackCount: 2, creator: { userId: 88 } },
        {
          id: 'cloud-storage',
          name: '云盘音乐',
          description: '',
          coverImgUrl: '',
          trackCount: 0,
          creator: { userId: '', nickname: '', avatarUrl: '' }
        }
      ]
    })
    global.__musicPlatformFactory__.getPlatform.mockReturnValue({ callModule })

    const client = new NeteaseClient('MUSIC_U=music-u')
    const playlists = await client.getUserPlaylist()

    expect(playlists[1]).toMatchObject({
      id: 'cloud-storage',
      name: '云盘音乐',
      coverUrl: '',
      trackCount: 0,
      creator: { id: '', name: '', avatarUrl: '' }
    })
  })

  test('userFavoriteTracks 通过用户喜欢的音乐歌单详情获取收藏歌曲，不再请求歌曲详情', async () => {
    const favoriteTrackIds = new Set()
    const callModule = jest.fn((route, options) => {
      if (route === 'user/playlist') {
        return Promise.resolve({
          code: 200,
          playlist: [
            { id: 100, name: '普通歌单', trackCount: 1, creator: {} },
            { id: 200, name: '小明喜欢的音乐', trackCount: 2, creator: {} },
            { id: 300, name: '小红喜欢的音乐', trackCount: 1, creator: {} }
          ]
        })
      }
      if (route === 'playlist/detail') {
        expect(options.query.id).toBe('200')
        return Promise.resolve({
          code: 200,
          playlist: {
            id: 200,
            name: '小明喜欢的音乐',
            trackCount: 2,
            creator: {},
            tracks: [
              { id: 33418857, name: '歌曲 A', ar: [], al: {} },
              { id: 1901371647, name: '歌曲 B', ar: [], al: {} }
            ]
          }
        })
      }
      return Promise.resolve({ code: 200 })
    })
    global.__musicPlatformFactory__.getPlatform.mockReturnValue({ callModule })

    const client = new NeteaseClient('MUSIC_U=music-u', favoriteTrackIds)
    const tracks = await client.userFavoriteTracks()

    expect(tracks.map((track) => track.id)).toEqual(['33418857', '1901371647'])
    expect(tracks.every((track) => track.favorite)).toBe(true)
    expect(favoriteTrackIds.has('33418857')).toBe(true)
    expect(favoriteTrackIds.has('1901371647')).toBe(true)
    expect(callModule).toHaveBeenCalledWith('user/playlist', expect.objectContaining({
      query: expect.objectContaining({
        MUSIC_U: 'music-u',
        platform: 'netease'
      })
    }))
    expect(callModule).toHaveBeenCalledWith('playlist/detail', expect.objectContaining({
      query: expect.objectContaining({
        id: '200',
        platform: 'netease'
      })
    }))
    expect(callModule).not.toHaveBeenCalledWith('likelist', expect.any(Object))
    expect(callModule).not.toHaveBeenCalledWith('song/detail', expect.any(Object))
  })

  test('榜单预览每个榜单固定返回三首歌', async () => {
    const callModule = jest.fn().mockResolvedValue({
      code: 200,
      data: [{
        name: '榜单推荐',
        displayType: 'ONLY_COVER',
        list: [{
          id: 1,
          name: '热歌榜',
          coverUrl: 'https://cover',
          updateFrequency: '每日更新',
          targetType: 'PLAYLIST',
          tracks: [
            { first: '第一首', second: '歌手 A' },
            { first: '第二首', second: '歌手 B' },
            { first: '第三首', second: '歌手 C' },
            { first: '第四首', second: '歌手 D' }
          ]
        }]
      }]
    })
    global.__musicPlatformFactory__.getPlatform.mockReturnValue({ callModule })

    const client = new NeteaseClient('MUSIC_U=music-u')
    const toplists = await client.getToplist()

    expect(callModule).toHaveBeenCalledWith('toplist/detail/v2', expect.objectContaining({
      query: expect.objectContaining({ MUSIC_U: 'music-u', platform: 'netease' })
    }))
    expect(toplists[0]).toMatchObject({ name: '榜单推荐', displayType: 'ONLY_COVER' })
    expect(toplists[0].list[0]).toMatchObject({ name: '热歌榜', targetType: 'PLAYLIST' })
    expect(toplists[0].list[0].tracks).toHaveLength(3)
    expect(toplists[0].list[0].tracks[0]).toEqual({ name: '第一首', artistName: '歌手 A' })
  })

  test('榜单详情透传 playlist.trackCount', async () => {
    const callModule = jest.fn().mockResolvedValue({
      code: 200,
      playlist: {
        id: 19723756,
        name: '飙升榜',
        coverImgUrl: '',
        trackCount: 100,
        creator: {},
        tracks: []
      }
    })
    global.__musicPlatformFactory__.getPlatform.mockReturnValue({ callModule })

    const client = new NeteaseClient('MUSIC_U=music-u')
    const detail = await client.getToplistTracks('19723756', 0, 100)

    expect(detail.trackCount).toBe(100)
  })

  test('榜单 API 过滤网页入口和无效歌单，移除空分组并保留无歌曲预览的有效榜单', async () => {
    const callModule = jest.fn((route) => Promise.resolve(route === 'toplist/detail/v2' ? {
      code: 200,
      data: [{
        name: '官方榜',
        displayType: 'TOP_3',
        list: [
          { id: 19723756, name: '飙升榜', targetType: 'PLAYLIST', canPlay: true },
          { id: 0, name: '畅销榜', targetType: 'H5', canPlay: false },
          { id: 0, name: '全民热推榜', targetType: 'H5', canPlay: false },
          { id: 0, name: '有声书榜', targetType: 'H5', canPlay: false },
          { id: 123, name: '网页入口', targetType: 'H5' },
          { id: 0, name: '无效歌单', targetType: 'PLAYLIST' },
          { name: '缺少 ID', targetType: 'PLAYLIST' },
          { id: 456, name: '播放受限但可查看详情的歌单榜', targetType: 'PLAYLIST', canPlay: false }
        ]
      }, {
        name: '实体榜',
        list: [{ id: 0, name: '实体专辑榜', targetType: 'H5', canPlay: false }]
      }, {
        name: '曲风榜',
        displayType: 'ONLY_COVER',
        list: [{ id: 71385702, name: '网易云ACG榜', targetType: 'PLAYLIST', tracks: null }]
      }]
    } : { code: 200, list: [] }))
    global.__musicPlatformFactory__.getPlatform.mockReturnValue({ callModule })

    const response = await request(createTrackUrlApp(new NeteaseClient(''))).get('/v1/toplist/list').expect(200)

    expect(response.body.data.map(({ name }) => name)).toEqual(['官方榜', '曲风榜'])
    expect(response.body.data.flatMap(({ list }) => list.map(({ id }) => id))).toEqual(['19723756', '456', '71385702'])
    expect(response.body.data[1].list[0].tracks).toEqual([])
  })

  test('完整榜单接口补齐 v2 遗漏的榜单，按 ID 去重并保留原有分组', async () => {
    const callModule = jest.fn((route) => Promise.resolve(route === 'toplist/detail/v2' ? {
      code: 200,
      data: [{
        name: '官方榜',
        displayType: 'TOP_3',
        list: [{ id: 19723756, name: '飙升榜', targetType: 'PLAYLIST', coverUrl: 'https://original-cover' }]
      }]
    } : {
      code: 200,
      list: [
        { id: '19723756', name: '飙升榜', coverImgUrl: 'https://other-cover' },
        { id: 1978921795, name: '网易云电音榜', coverImgUrl: 'https://edm-cover', updateFrequency: '每周五更新' },
        { id: '1978921795', name: '网易云电音榜' },
        { id: 3001835560, name: '网易云ACG动画榜', tracks: [{ first: '歌曲', second: '歌手' }] },
        { id: 0, name: '无效入口' },
        { id: 123, name: '网页入口', targetType: 'H5' }
      ]
    }))
    global.__musicPlatformFactory__.getPlatform.mockReturnValue({ callModule })

    const response = await request(createTrackUrlApp(new NeteaseClient('MUSIC_U=music-u'))).get('/v1/toplist/list').expect(200)
    const groups = response.body.data

    expect(groups).toHaveLength(2)
    expect(groups[0]).toMatchObject({ name: '官方榜', displayType: 'TOP_3', list: [{ id: '19723756', coverUrl: 'https://original-cover' }] })
    expect(groups[1]).toMatchObject({ name: '更多榜单', displayType: 'ONLY_COVER' })
    expect(groups[1].list).toEqual([
      { id: '1978921795', name: '网易云电音榜', coverUrl: 'https://edm-cover', updateFrequency: '每周五更新', tracks: [], targetType: 'PLAYLIST' },
      { id: '3001835560', name: '网易云ACG动画榜', coverUrl: '', updateFrequency: '', tracks: [{ name: '歌曲', artistName: '歌手' }], targetType: 'PLAYLIST' }
    ])
    expect(callModule).toHaveBeenCalledWith('toplist/detail', expect.objectContaining({
      query: expect.objectContaining({ MUSIC_U: 'music-u', platform: 'netease' })
    }))
  })

  test('补充榜单请求失败时仍返回 v2 的有效榜单', async () => {
    const callModule = jest.fn((route) => Promise.resolve(route === 'toplist/detail/v2' ? {
      code: 200,
      data: [{ name: '官方榜', list: [{ id: 19723756, name: '飙升榜', targetType: 'PLAYLIST' }] }]
    } : { code: 502, message: 'Upstream unavailable' }))
    global.__musicPlatformFactory__.getPlatform.mockReturnValue({ callModule })

    const groups = await new NeteaseClient('').getToplist()

    expect(groups).toHaveLength(1)
    expect(groups[0].list.map(({ id }) => id)).toEqual(['19723756'])
  })

  test('两个榜单接口复用现有平台缓存，跨账号共享并在 24 小时后刷新上游', async () => {
    const BasePlatform = require('../../../platforms/base/BasePlatform')
    const { PlatformCache } = require('../../../core/PlatformCache')
    const platform = new BasePlatform({ name: 'netease' })
    platform.cache = new PlatformCache()
    platform.initialized = true
    platform.modules.set('toplist/detail/v2', require('../../../platforms/netease/module/toplist_detail_v2'))
    platform.modules.set('toplist/detail', require('../../../platforms/netease/module/toplist_detail'))
    const upstream = jest.fn((uri) => Promise.resolve({ body: uri.endsWith('/v2') ? {
      code: 200,
      data: [{ name: '官方榜', list: [{ id: 19723756, name: '飙升榜', targetType: 'PLAYLIST' }] }]
    } : { code: 200, list: [{ id: 1978921795, name: '网易云电音榜' }] } }))
    platform.createRequestFunction = () => upstream
    global.__musicPlatformFactory__.getPlatform.mockReturnValue(platform)
    const startedAt = Date.now()
    const now = jest.spyOn(Date, 'now').mockReturnValue(startedAt)

    const first = await new NeteaseClient('MUSIC_U=first-account').getToplist()
    const second = await new NeteaseClient('MUSIC_U=second-account').getToplist()

    expect(second).toEqual(first)
    expect(upstream.mock.calls.map(([uri]) => uri)).toEqual(['/api/toplist/detail/v2', '/api/toplist/detail'])

    now.mockReturnValue(startedAt + 24 * 60 * 60 * 1000 - 1)
    await new NeteaseClient('').getToplist()
    expect(upstream).toHaveBeenCalledTimes(2)

    now.mockReturnValue(startedAt + 24 * 60 * 60 * 1000 + 1)
    await new NeteaseClient('').getToplist()
    expect(upstream.mock.calls.filter(([uri]) => uri.endsWith('/v2'))).toHaveLength(2)
    expect(upstream.mock.calls.filter(([uri]) => uri === '/api/toplist/detail')).toHaveLength(2)
  })

  test('favoritePlaylist 通过网易云歌单收藏模块按状态收藏或取消收藏', async () => {
    const callModule = jest.fn().mockResolvedValue({ code: 200 })
    global.__musicPlatformFactory__.getPlatform.mockReturnValue({ callModule })

    const client = new NeteaseClient('MUSIC_U=music-u')

    await expect(client.favoritePlaylist('987', true)).resolves.toEqual({ success: true, status: true })
    expect(callModule).toHaveBeenLastCalledWith('playlist/subscribe', expect.objectContaining({
      query: expect.objectContaining({
        id: '987',
        t: 1,
        MUSIC_U: 'music-u',
        platform: 'netease'
      })
    }))

    await expect(client.favoritePlaylist('987', false)).resolves.toEqual({ success: true, status: false })
    expect(callModule).toHaveBeenLastCalledWith('playlist/subscribe', expect.objectContaining({
      query: expect.objectContaining({
        id: '987',
        t: 0,
        MUSIC_U: 'music-u',
        platform: 'netease'
      })
    }))
  })

  test('favoritePlaylist 遇到网易云重复收藏 501 时返回失败但保留目标状态', async () => {
    const callModule = jest.fn().mockResolvedValue({
      code: 200,
      data: { code: 501 }
    })
    global.__musicPlatformFactory__.getPlatform.mockReturnValue({ callModule })

    const client = new NeteaseClient('MUSIC_U=music-u')

    await expect(client.favoritePlaylist('987', true)).resolves.toEqual({ success: false, status: true })
  })
})
