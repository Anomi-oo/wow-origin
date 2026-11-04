jest.mock('../../rewrite/shims/crypto', () => ({ randomUUID: () => 'generated-key' }))

jest.mock('../../rewrite/storage', () => {
  const values = new Map()
  return {
    storageGet: (key) => values.get(key) ?? null,
    storageSet: (value, key) => { values.set(key, value); return true }
  }
})

jest.mock('../../rewrite/runtime', () => ({
  authorizationToken: (headers) => String(headers.authorization || '').replace(/^Bearer\s+/i, ''),
  json: (status, value) => ({ status, body: JSON.stringify(value) })
}))

const { ProxyAccountStore } = require('../../rewrite/account-store')
const { proxyAccounts } = require('../../rewrite/account-store')
const { dispatchWowRoute } = require('../../rewrite/routes')

afterEach(() => {
  delete global.__musicPlatformFactory__
})

test('代理账号持久保存艺人和专辑收藏 ID，更新 Cookie 后重新初始化', () => {
  const store = new ProxyAccountStore()
  const account = store.create({ platform: 'qq', name: 'QQ', cookie: 'old', apiAccessKey: 'key' })
  expect(account.favoriteArtistIds).toBeNull()
  expect(account.favoriteAlbumIds).toBeNull()

  store.update('key', { userPlaylistIds: ['playlist-1', 'playlist-1'], favoriteArtistIds: ['artist-1', 'artist-1'], favoriteAlbumIds: ['123'] })
  expect(store.find('key')).toMatchObject({ userPlaylistIds: ['playlist-1'], favoriteArtistIds: ['artist-1'], favoriteAlbumIds: ['123'] })

  store.update('key', { cookie: 'new' })
  expect(store.find('key')).toMatchObject({ favoriteTrackIds: [], userPlaylistIds: null, favoriteArtistIds: null, favoriteAlbumIds: null })
})

test('代理重取四类用户列表后持久化替换旧 ID', async () => {
  proxyAccounts.create({ platform: 'qq', name: 'QQ', cookie: 'uin=o123; qm_keyst=key', apiAccessKey: 'refresh-key' })
  let phase = 1
  const callModule = jest.fn((route) => {
    if (route === 'user/playlist') {
      return Promise.resolve({ code: 200, playlist: [{ id: 100 + phase, dirId: 201, name: '我喜欢' }] })
    }
    if (route === 'playlist/detail') {
      return Promise.resolve({ code: 200, playlist: {
        id: 100 + phase, name: '我喜欢',
        tracks: [{ id: phase, mid: `track-${phase}`, name: '歌曲', ar: [], al: {} }]
      } })
    }
    if (route === 'artist/sublist') {
      return Promise.resolve({ code: 200, data: [{ id: `artist-${phase}`, name: '艺人' }], more: false })
    }
    if (route === 'album/sublist') {
      return Promise.resolve({ code: 200, data: [{ id: 200 + phase, name: '专辑' }], more: false })
    }
    throw new Error(`unexpected route: ${route}`)
  })
  global.__musicPlatformFactory__ = { getPlatform: () => ({ callModule }) }
  const request = (path) => {
    const url = new URL(`https://pinhaoge.xyz/v1${path}`)
    return { method: 'GET', url, path: url.pathname, headers: { authorization: 'Bearer refresh-key' }, query: {}, body: {}, rawBody: '' }
  }

  for (phase of [1, 2]) {
    for (const path of ['/user/favorite/tracks', '/user/playlist/list', '/user/artist/list', '/user/album/list']) {
      const current = request(path)
      const response = await dispatchWowRoute(current, current.path, '')
      expect(response.status).toBe(200)
    }
    expect(proxyAccounts.find('refresh-key')).toMatchObject({
      favoriteTrackIds: [`track-${phase}`],
      userPlaylistIds: [String(100 + phase)],
      favoriteArtistIds: [`artist-${phase}`],
      favoriteAlbumIds: [String(200 + phase)]
    })
  }
})

test('代理专辑详情首次读取收藏列表后持久复用 ID', async () => {
  proxyAccounts.create({ platform: 'qq', name: 'QQ', cookie: 'uin=o123; qm_keyst=key', apiAccessKey: 'route-key' })
  const callModule = jest.fn((route) => {
    if (route === 'artist/sublist') return Promise.resolve({ code: 200, data: [{ id: 'artist-mid', name: '艺人' }], more: false })
    if (route === 'album/sublist') return Promise.resolve({ code: 200, data: [{ id: 123, name: '专辑' }], more: false })
    if (route === 'album') return Promise.resolve({ code: 200, id: 123, name: '专辑', singermid: 'artist-mid', list: [] })
    throw new Error(`unexpected route: ${route}`)
  })
  global.__musicPlatformFactory__ = { getPlatform: () => ({ callModule }) }
  const url = new URL('https://pinhaoge.xyz/v1/album/detail?id=123&trackLimit=0')
  const request = {
    method: 'GET', url, path: url.pathname,
    headers: { authorization: 'Bearer route-key' },
    query: Object.fromEntries(url.searchParams), body: {}, rawBody: ''
  }

  const first = await dispatchWowRoute(request, request.path, '')
  expect(first.status).toBe(200)
  expect(JSON.parse(first.body).data).toMatchObject({ favorite: true, artist: { favorite: true } })
  expect(proxyAccounts.find('route-key')).toMatchObject({ favoriteArtistIds: ['artist-mid'], favoriteAlbumIds: ['123'] })

  callModule.mockClear()
  const second = await dispatchWowRoute(request, request.path, '')
  expect(second.status).toBe(200)
  expect(callModule.mock.calls.map(([route]) => route)).toEqual(['album'])
})
