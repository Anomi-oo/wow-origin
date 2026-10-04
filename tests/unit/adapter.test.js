const { createAdapter, createMusicClient, createWowContextResolver } = require('../../dist/adapter')
const { QQClient } = require('../../dist/clients/QQClient')
const { NeteaseClient } = require('../../dist/clients/NeteaseClient')

describe('Wow adapter', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  test('创建对应 client', () => {
    expect(createMusicClient('qq', 'cookie')).toBeInstanceOf(QQClient)
    expect(createMusicClient('netease', 'cookie')).toBeInstanceOf(NeteaseClient)
  })

  test('根据账号创建 SDK Adapter', () => {
    const adapter = createAdapter({
      platform: 'netease',
      name: '网易云',
      cookie: 'cookie-value',
      apiAccessKey: 'token-1',
      favoriteTrackIds: new Set()
    })

    expect(adapter).toBeInstanceOf(NeteaseClient)
  })

  test('无 cookie 时优先通过洛雪源解析音频地址', async () => {
    const lxTrackUrl = {
      url: 'https://audio.test/song.mp3',
      quality: 'exhigh',
      format: '',
      bitrate: 320000,
      size: 0
    }
    const lxResolver = {
      resolveTrackUrl: jest.fn().mockResolvedValue(lxTrackUrl)
    }
    const adapter = createAdapter({
      platform: 'qq',
      name: 'QQ',
      cookie: '  ',
      apiAccessKey: 'token-1',
      favoriteTrackIds: new Set()
    }, lxResolver)

    await expect(adapter.getTrackUrl('track-1', 'higher')).resolves.toEqual(lxTrackUrl)
    expect(lxResolver.resolveTrackUrl).toHaveBeenCalledWith('qq', 'track-1', 'higher')
  })

  test('存在 cookie 时仍优先使用洛雪源，避免返回官方 30 秒试听地址', async () => {
    const officialTrackUrl = {
      url: 'https://official.test/song.mp3',
      quality: 'exhigh',
      format: 'mp3',
      bitrate: 320000,
      size: 0
    }
    const officialSpy = jest.spyOn(NeteaseClient.prototype, 'getTrackUrl').mockResolvedValue(officialTrackUrl)
    const lxTrackUrl = {
      url: 'https://audio.test/full-song.mp3',
      quality: 'exhigh',
      format: 'mp3',
      bitrate: 320000,
      size: 0
    }
    const lxResolver = {
      resolveTrackUrl: jest.fn().mockResolvedValue(lxTrackUrl)
    }
    const adapter = createAdapter({
      platform: 'netease',
      name: '网易云',
      cookie: 'MUSIC_U=value',
      apiAccessKey: 'token-1',
      useLuoxue: true,
      favoriteTrackIds: new Set()
    }, lxResolver)

    await expect(adapter.getTrackUrl('track-1', 'higher')).resolves.toEqual(lxTrackUrl)
    expect(lxResolver.resolveTrackUrl).toHaveBeenCalledWith('netease', 'track-1', 'higher')
    expect(officialSpy).not.toHaveBeenCalled()
  })

  test('高清臻音使用网易云专用档位，不把洛雪 Hi-Res 标成高清臻音', async () => {
    const officialTrackUrl = {
      url: 'https://official.test/jyeffect.flac', quality: 'jyeffect', format: 'flac', bitrate: null, size: 100
    }
    const officialSpy = jest.spyOn(NeteaseClient.prototype, 'getTrackUrl').mockResolvedValue(officialTrackUrl)
    const lxResolver = { resolveTrackUrl: jest.fn().mockResolvedValue({
      url: 'https://lx.test/hires.flac', quality: 'hires', format: 'flac', bitrate: null, size: 100
    }) }
    const adapter = createAdapter({
      platform: 'netease', name: '网易云', cookie: 'MUSIC_U=value', apiAccessKey: 'token-1',
      useLuoxue: true, favoriteTrackIds: new Set()
    }, lxResolver)

    await expect(adapter.getTrackUrl('track-1', 'jyeffect')).resolves.toEqual(officialTrackUrl)
    expect(officialSpy).toHaveBeenCalledWith('track-1', 'jyeffect')
    expect(lxResolver.resolveTrackUrl).not.toHaveBeenCalled()
  })

  test('QQ 新音质优先调用官方模块，避免洛雪 SQ 冒充高音质', async () => {
    const officialTrackUrl = {
      url: 'https://official.test/master.flac', quality: 'master', format: 'flac', bitrate: null, size: 100
    }
    const officialSpy = jest.spyOn(QQClient.prototype, 'getTrackUrl').mockResolvedValue(officialTrackUrl)
    const lxResolver = { resolveTrackUrl: jest.fn() }
    const adapter = createAdapter({
      platform: 'qq', name: 'QQ', cookie: 'uin=1; qm_keyst=value', apiAccessKey: 'token-1',
      useLuoxue: true, favoriteTrackIds: new Set()
    }, lxResolver)

    await expect(adapter.getTrackUrl('track-1', 'master')).resolves.toEqual(officialTrackUrl)
    expect(officialSpy).toHaveBeenCalledWith('track-1', 'master')
    expect(lxResolver.resolveTrackUrl).not.toHaveBeenCalled()
  })

  test('存在 cookie 且洛雪源无结果时回退到官方地址', async () => {
    const officialTrackUrl = {
      url: 'https://official.test/song.mp3',
      quality: 'exhigh',
      format: 'mp3',
      bitrate: 320000,
      size: 0
    }
    const officialSpy = jest.spyOn(QQClient.prototype, 'getTrackUrl').mockResolvedValue(officialTrackUrl)
    const lxResolver = {
      resolveTrackUrl: jest.fn().mockResolvedValue(undefined)
    }
    const adapter = createAdapter({
      platform: 'qq',
      name: 'QQ',
      cookie: 'uin=1; qm_keyst=value',
      apiAccessKey: 'token-1',
      useLuoxue: true,
      favoriteTrackIds: new Set()
    }, lxResolver)

    await expect(adapter.getTrackUrl('track-1', 'higher')).resolves.toEqual(officialTrackUrl)
    expect(lxResolver.resolveTrackUrl).toHaveBeenCalledWith('qq', 'track-1', 'higher')
    expect(officialSpy).toHaveBeenCalledWith('track-1', 'higher')
    expect(lxResolver.resolveTrackUrl.mock.invocationCallOrder[0]).toBeLessThan(officialSpy.mock.invocationCallOrder[0])
  })

  test('存在 cookie 且洛雪源返回无效 URL 时回退到官方地址', async () => {
    const officialTrackUrl = {
      url: 'https://official.test/song.mp3',
      quality: 'exhigh',
      format: 'mp3',
      bitrate: 320000,
      size: 0
    }
    jest.spyOn(QQClient.prototype, 'getTrackUrl').mockResolvedValue(officialTrackUrl)
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    const invalidLxTrackUrl = {
      url: '',
      quality: 'exhigh',
      format: '',
      bitrate: 320000,
      size: 0
    }
    const lxResolver = {
      resolveTrackUrl: jest.fn().mockResolvedValue(invalidLxTrackUrl)
    }
    const adapter = createAdapter({
      platform: 'qq',
      name: 'QQ',
      cookie: 'uin=1; qm_keyst=value',
      apiAccessKey: 'token-1',
      useLuoxue: true,
      favoriteTrackIds: new Set()
    }, lxResolver)

    await expect(adapter.getTrackUrl('track-1', 'higher')).resolves.toEqual(officialTrackUrl)
  })

  test('官方和洛雪源都失败时重新抛出原始官方错误', async () => {
    const officialError = new Error('official failed')
    jest.spyOn(QQClient.prototype, 'getTrackUrl').mockRejectedValue(officialError)
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    const lxResolver = {
      resolveTrackUrl: jest.fn().mockRejectedValue(new Error('lx internal failure'))
    }
    const adapter = createAdapter({
      platform: 'qq',
      name: 'QQ',
      cookie: 'uin=1; qm_keyst=value',
      apiAccessKey: 'token-1',
      useLuoxue: true,
      favoriteTrackIds: new Set()
    }, lxResolver)

    await expect(adapter.getTrackUrl('track-1', 'higher')).rejects.toBe(officialError)
  })

  test('洛雪源链无结果时回落到当前平台默认流程', async () => {
    const defaultTrackUrl = {
      url: 'https://default.test/song.mp3',
      quality: 'standard',
      format: 'mp3',
      bitrate: 128000,
      size: 0
    }
    const defaultSpy = jest.spyOn(QQClient.prototype, 'getTrackUrl').mockResolvedValue(defaultTrackUrl)
    const lxResolver = {
      resolveTrackUrl: jest.fn().mockResolvedValue(undefined)
    }
    const adapter = createAdapter({
      platform: 'qq',
      name: 'QQ',
      cookie: '',
      apiAccessKey: 'token-1',
      favoriteTrackIds: new Set()
    }, lxResolver)

    await expect(adapter.getTrackUrl('track-1', 'standard')).resolves.toEqual(defaultTrackUrl)
    expect(defaultSpy).toHaveBeenCalledWith('track-1', 'standard')
  })

  test('无 cookie 时洛雪源抛错不会覆盖匿名官方结果', async () => {
    const officialTrackUrl = {
      url: 'https://official.test/song.mp3',
      quality: 'standard',
      format: 'mp3',
      bitrate: 128000,
      size: 0
    }
    jest.spyOn(QQClient.prototype, 'getTrackUrl').mockResolvedValue(officialTrackUrl)
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    const lxResolver = {
      resolveTrackUrl: jest.fn().mockRejectedValue(new Error('lx internal failure'))
    }
    const adapter = createAdapter({
      platform: 'qq',
      name: 'QQ',
      cookie: '',
      apiAccessKey: 'token-1',
      useLuoxue: true,
      favoriteTrackIds: new Set()
    }, lxResolver)

    await expect(adapter.getTrackUrl('track-1', 'standard')).resolves.toEqual(officialTrackUrl)
  })

  test.each([
    ['无 cookie', ''],
    ['有 cookie', 'MUSIC_U=value']
  ])('useLuoxue 为 false 时%s都不调用洛雪源', async (_label, cookie) => {
    const officialTrackUrl = {
      url: 'https://official.test/song.mp3',
      quality: 'standard',
      format: 'mp3',
      bitrate: 128000,
      size: 0
    }
    const officialSpy = jest.spyOn(NeteaseClient.prototype, 'getTrackUrl').mockResolvedValue(officialTrackUrl)
    const lxResolver = {
      resolveTrackUrl: jest.fn()
    }
    const adapter = createAdapter({
      platform: 'netease',
      name: '网易云',
      cookie,
      apiAccessKey: 'token-1',
      useLuoxue: false,
      favoriteTrackIds: new Set()
    }, lxResolver)

    await expect(adapter.getTrackUrl('track-1', 'standard')).resolves.toEqual(officialTrackUrl)
    expect(officialSpy).toHaveBeenCalledWith('track-1', 'standard')
    expect(lxResolver.resolveTrackUrl).not.toHaveBeenCalled()
  })

  test('resolver 根据 Bearer token 返回 SDK 请求上下文', async () => {
    const resolver = createWowContextResolver({
      sessions: [],
      byAccessKey: new Map([
        ['token-1', {
          platform: 'netease',
          name: '网易云',
          cookie: 'cookie-value',
          apiAccessKey: 'token-1',
          stateless: false,
          favoriteTrackIds: new Set()
        }]
      ])
    })
    const context = await resolver({ authorization: 'Bearer token-1', request: {} })

    expect(context.accountName).toBe('网易云')
    expect(context.stateless).toBe(false)
    expect(context.adapter).toBeInstanceOf(NeteaseClient)
    expect(context.qualityMap).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'standard' })
    ]))
  })

  test('resolver 在认证失败时返回 null', async () => {
    const resolver = createWowContextResolver({ sessions: [], byAccessKey: new Map() })

    await expect(resolver({ authorization: undefined, request: {} })).resolves.toBeNull()
  })

  test('未预加载的账号首次打开专辑详情时只加载一次艺人和专辑收藏', async () => {
    const account = {
      platform: 'qq', name: 'QQ', cookie: 'uin=o123; qm_keyst=key', apiAccessKey: 'token-1',
      favoriteTrackIds: new Set(), favoriteArtistIds: new Set(), favoriteAlbumIds: new Set(),
      favoriteArtistsLoaded: false, favoriteAlbumsLoaded: false
    }
    const artistLoad = jest.spyOn(QQClient.prototype, 'userArtists').mockImplementation(async function () {
      this.favoriteArtistSet.add('artist-mid')
      return [{ id: 'artist-mid' }]
    })
    const albumLoad = jest.spyOn(QQClient.prototype, 'userAlbums').mockImplementation(async function () {
      this.favoriteAlbumSet.add('123')
      return [{ id: '123' }]
    })
    const resolver = createWowContextResolver({ sessions: [account], byAccessKey: new Map([['token-1', account]]) })
    const input = { authorization: 'Bearer token-1', request: { path: '/album/detail' } }

    await resolver(input)
    await resolver(input)

    expect(artistLoad).toHaveBeenCalledTimes(1)
    expect(albumLoad).toHaveBeenCalledTimes(1)
    expect(account.favoriteArtistIds.has('artist-mid')).toBe(true)
    expect(account.favoriteAlbumIds.has('123')).toBe(true)
  })

  test('直接重取艺人和专辑列表后标记账号已加载', async () => {
    const account = {
      platform: 'qq', name: 'QQ', cookie: 'uin=o123; qm_keyst=key', apiAccessKey: 'token-1',
      favoriteTrackIds: new Set(), userPlaylistIds: new Set(),
      favoriteArtistIds: new Set(), favoriteAlbumIds: new Set(),
      favoriteArtistsLoaded: false, favoriteAlbumsLoaded: false
    }
    const artistLoad = jest.spyOn(QQClient.prototype, 'userArtists').mockResolvedValue([{ id: 'artist-mid' }])
    const albumLoad = jest.spyOn(QQClient.prototype, 'userAlbums').mockResolvedValue([{ id: '123' }])
    const resolver = createWowContextResolver({ sessions: [account], byAccessKey: new Map([['token-1', account]]) })
    const context = await resolver({ authorization: 'Bearer token-1', request: { path: '/user/artist/list' } })
    await context.adapter.userArtists()
    await context.adapter.userAlbums()
    await resolver({ authorization: 'Bearer token-1', request: { path: '/album/detail' } })

    expect(account.favoriteArtistsLoaded).toBe(true)
    expect(account.favoriteAlbumsLoaded).toBe(true)
    expect(artistLoad).toHaveBeenCalledTimes(1)
    expect(albumLoad).toHaveBeenCalledTimes(1)
  })
})
