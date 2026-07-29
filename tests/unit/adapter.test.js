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

  test('存在 cookie 且官方成功时不调用洛雪源', async () => {
    const officialTrackUrl = {
      url: 'https://official.test/song.mp3',
      quality: 'exhigh',
      format: 'mp3',
      bitrate: 320000,
      size: 0
    }
    const officialSpy = jest.spyOn(NeteaseClient.prototype, 'getTrackUrl').mockResolvedValue(officialTrackUrl)
    const lxResolver = {
      resolveTrackUrl: jest.fn()
    }
    const adapter = createAdapter({
      platform: 'netease',
      name: '网易云',
      cookie: 'MUSIC_U=value',
      apiAccessKey: 'token-1',
      needUnlock: true,
      favoriteTrackIds: new Set()
    }, lxResolver)

    await expect(adapter.getTrackUrl('track-1', 'higher')).resolves.toEqual(officialTrackUrl)
    expect(officialSpy).toHaveBeenCalledWith('track-1', 'higher')
    expect(lxResolver.resolveTrackUrl).not.toHaveBeenCalled()
  })

  test('存在 cookie 且官方失败时回退到洛雪源', async () => {
    const officialError = new Error('official failed')
    jest.spyOn(QQClient.prototype, 'getTrackUrl').mockRejectedValue(officialError)
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
      cookie: 'uin=1; qm_keyst=value',
      apiAccessKey: 'token-1',
      needUnlock: true,
      favoriteTrackIds: new Set()
    }, lxResolver)

    await expect(adapter.getTrackUrl('track-1', 'higher')).resolves.toEqual(lxTrackUrl)
    expect(lxResolver.resolveTrackUrl).toHaveBeenCalledWith('qq', 'track-1', 'higher')
  })

  test('存在 cookie 且官方返回无效 URL 时回退到洛雪源', async () => {
    jest.spyOn(QQClient.prototype, 'getTrackUrl').mockResolvedValue({
      url: '',
      quality: 'exhigh',
      format: 'mp3',
      bitrate: 320000,
      size: 0
    })
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
      cookie: 'uin=1; qm_keyst=value',
      apiAccessKey: 'token-1',
      needUnlock: true,
      favoriteTrackIds: new Set()
    }, lxResolver)

    await expect(adapter.getTrackUrl('track-1', 'higher')).resolves.toEqual(lxTrackUrl)
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
      needUnlock: true,
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
      needUnlock: true,
      favoriteTrackIds: new Set()
    }, lxResolver)

    await expect(adapter.getTrackUrl('track-1', 'standard')).resolves.toEqual(officialTrackUrl)
  })

  test.each([
    ['无 cookie', ''],
    ['有 cookie', 'MUSIC_U=value']
  ])('needUnlock 为 false 时%s都不调用洛雪源', async (_label, cookie) => {
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
      needUnlock: false,
      favoriteTrackIds: new Set()
    }, lxResolver)

    await expect(adapter.getTrackUrl('track-1', 'standard')).resolves.toEqual(officialTrackUrl)
    expect(officialSpy).toHaveBeenCalledWith('track-1', 'standard')
    expect(lxResolver.resolveTrackUrl).not.toHaveBeenCalled()
  })

  test('resolver 根据 Bearer token 返回 SDK 请求上下文', () => {
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
    const context = resolver({ authorization: 'Bearer token-1', request: {} })

    expect(context.accountName).toBe('网易云')
    expect(context.stateless).toBe(false)
    expect(context.adapter).toBeInstanceOf(NeteaseClient)
    expect(context.qualityMap).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'standard' })
    ]))
  })

  test('resolver 在认证失败时返回 null', () => {
    const resolver = createWowContextResolver({ sessions: [], byAccessKey: new Map() })

    expect(resolver({ authorization: undefined, request: {} })).toBeNull()
  })
})
