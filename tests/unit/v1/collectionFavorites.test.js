const { NeteaseClient } = require('../../../dist/clients/NeteaseClient')
const { QQClient } = require('../../../dist/clients/QQClient')

describe('artist and album favorites', () => {
  afterEach(() => {
    delete global.__musicPlatformFactory__
  })

  test('Netease writes both target states and loads every subscribed page', async () => {
    const callModule = jest.fn((route, { query }) => {
      if (route === 'artist/sublist' || route === 'album/sublist') {
        const item = route === 'artist/sublist'
          ? { id: 1 + query.offset, name: '艺人', picUrl: 'artist.jpg' }
          : { id: 10 + query.offset, name: '专辑', picUrl: 'album.jpg' }
        return Promise.resolve({ code: 200, data: [item], hasMore: query.offset === 0 })
      }
      return Promise.resolve({ code: 200 })
    })
    global.__musicPlatformFactory__ = { getPlatform: () => ({ callModule }) }
    const artists = new Set()
    const albums = new Set(['10'])
    const client = new NeteaseClient('MUSIC_U=music-u', new Set(), artists, albums)

    await expect(client.favoriteArtist('1', true)).resolves.toEqual({ success: true, status: true })
    await expect(client.favoriteAlbum('10', false)).resolves.toEqual({ success: true, status: false })
    expect(artists.has('1')).toBe(true)
    expect(albums.has('10')).toBe(false)
    expect(callModule).toHaveBeenCalledWith('artist/sub', expect.objectContaining({ query: expect.objectContaining({ id: '1', t: 1, MUSIC_U: 'music-u' }) }))
    expect(callModule).toHaveBeenCalledWith('album/sub', expect.objectContaining({ query: expect.objectContaining({ id: '10', t: 0, MUSIC_U: 'music-u' }) }))
    await expect(client.userArtists()).resolves.toMatchObject([{ id: '1', favorite: true }, { id: '101', favorite: true }])
    await expect(client.userAlbums()).resolves.toMatchObject([{ id: '10', favorite: true }, { id: '110', favorite: true }])
  })

  test('QQ maps subscribed album numeric IDs and reports mutation failures', async () => {
    const callModule = jest.fn((route, { query }) => {
      if (route === 'artist/sublist') {
        const id = query.offset === 0 ? 'artist-mid' : 'artist-mid-2'
        return Promise.resolve({ code: 200, data: [{ id, name: '艺人' }], more: query.offset === 0 })
      }
      if (route === 'album/sublist') {
        return Promise.resolve({ code: 200, data: [{ id: 123, mid: 'album-mid', name: '专辑', createTime: 1700000000000 }], more: false })
      }
      return Promise.resolve({ code: 200, body: { retCode: route === 'artist/sub' ? 0 : 1 } })
    })
    global.__musicPlatformFactory__ = { getPlatform: () => ({ callModule }) }
    const artists = new Set(['artist-mid'])
    const albums = new Set()
    const client = new QQClient('uin=o123; qm_keyst=key', new Set(), artists, albums)

    await expect(client.favoriteArtist('artist-mid', false)).resolves.toEqual({ success: true, status: false })
    await expect(client.favoriteAlbum('123', true)).resolves.toEqual({ success: false, status: false })
    expect(artists.has('artist-mid')).toBe(false)
    expect(albums.has('123')).toBe(false)
    expect(callModule).toHaveBeenCalledWith('artist/sub', expect.objectContaining({ query: expect.objectContaining({ t: 0, uin: '123', qm_keyst: 'key' }) }))
    expect(callModule).toHaveBeenCalledWith('album/sub', expect.objectContaining({ query: expect.objectContaining({ t: 1, uin: '123', qm_keyst: 'key' }) }))
    await expect(client.userArtists()).resolves.toMatchObject([{ id: 'artist-mid', favorite: true }, { id: 'artist-mid-2', favorite: true }])
    await expect(client.userAlbums()).resolves.toMatchObject([{ id: '123', favorite: true, publishTime: 1700000000000 }])
  })

  test.each([
    ['Netease', NeteaseClient, 'MUSIC_U=music-u', 'song-id'],
    ['QQ', QQClient, 'uin=o123; qm_keyst=key', 'song-mid']
  ])('%s details include collection favorites and each track favorite', async (platform, Client, cookie, trackID) => {
    const artistID = platform === 'QQ' ? 'artist-mid' : '11'
    const albumID = platform === 'QQ' ? '123' : '22'
    const song = platform === 'QQ'
      ? { id: 1, mid: trackID, name: '歌曲', ar: [{ mid: artistID, name: '艺人' }], al: { id: 123, mid: 'album-mid', name: '专辑' }, dt: 1000 }
      : { id: trackID, name: '歌曲', ar: [{ id: artistID, name: '艺人' }], al: { id: albumID, name: '专辑' }, dt: 1000 }
    const callModule = jest.fn((route) => {
      if (route === 'artist/sublist') return Promise.resolve({ code: 200, data: [{ id: artistID, mid: artistID, name: '艺人' }], more: false })
      if (route === 'album/sublist') return Promise.resolve({ code: 200, data: [{ id: albumID, name: '专辑' }], more: false })
      if (route === 'artist/detail') return Promise.resolve({ code: 200, data: { artist: { id: artistID, name: '艺人' } } })
      if (route === 'artist/tracks') return Promise.resolve({ code: 200, songs: [song] })
      if (route === 'album') {
        return Promise.resolve(platform === 'QQ'
          ? { code: 200, id: 123, mid: 'album-mid', name: '专辑', singermid: artistID, list: [song] }
          : { code: 200, album: { id: albumID, name: '专辑', artist: { id: artistID, name: '艺人' } }, songs: [song] })
      }
      return Promise.resolve({ code: 200 })
    })
    global.__musicPlatformFactory__ = { getPlatform: () => ({ callModule }) }
    const artistIds = new Set()
    const albumIds = new Set()
    const client = new Client(cookie, new Set([trackID]), artistIds, albumIds)
    await client.userArtists()
    await client.userAlbums()
    expect(artistIds.has(artistID)).toBe(true)
    expect(albumIds.has(albumID)).toBe(true)
    callModule.mockClear()

    const artist = await client.getArtistDetail(artistID)
    const album = await client.getAlbumDetail(albumID)

    expect(callModule.mock.calls.map(([route]) => route)).not.toContain('artist/sublist')
    expect(callModule.mock.calls.map(([route]) => route)).not.toContain('album/sublist')

    expect(artist.favorite).toBe(true)
    expect(artist.tracks[0].favorite).toBe(true)
    expect(artist.tracks[0].artists[0].favorite).toBe(true)
    expect(album.favorite).toBe(true)
    expect(album.artist.favorite).toBe(true)
    expect(album.tracks[0].favorite).toBe(true)
    expect(album.tracks[0].album.favorite).toBe(true)
  })

  test.each([
    ['Netease', NeteaseClient, 'MUSIC_U=music-u'],
    ['QQ', QQClient, 'uin=o123; qm_keyst=key']
  ])('%s detail with trackLimit=0 reports unsubscribed collections as false', async (platform, Client, cookie) => {
    const callModule = jest.fn((route) => {
      if (route === 'artist/sublist' || route === 'album/sublist') {
        return Promise.resolve({ code: 200, data: [], more: false })
      }
      if (route === 'artist/detail') {
        return Promise.resolve({ code: 200, data: { artist: { id: 'artist-id', name: '艺人' } } })
      }
      if (route === 'album') {
        return Promise.resolve(platform === 'QQ'
          ? { code: 200, id: 123, name: '专辑', list: [] }
          : { code: 200, album: { id: 123, name: '专辑' }, songs: [] })
      }
      throw new Error(`unexpected route: ${route}`)
    })
    global.__musicPlatformFactory__ = { getPlatform: () => ({ callModule }) }
    const client = new Client(cookie)

    await expect(client.getArtistDetail('artist-id', 0)).resolves.toMatchObject({ favorite: false, tracks: [] })
    await expect(client.getAlbumDetail('123', 0)).resolves.toMatchObject({ favorite: false, tracks: [] })
    expect(callModule).not.toHaveBeenCalledWith('artist/tracks', expect.anything())
  })

  test('收藏写入后新建 client 仍从账号共享集合读取状态', async () => {
    const callModule = jest.fn((route) => {
      if (route === 'artist/sub') return Promise.resolve({ code: 200, body: { retCode: 0 } })
      if (route === 'artist/detail') return Promise.resolve({ code: 200, data: { artist: { id: 'artist-mid', name: '艺人' } } })
      throw new Error(`unexpected route: ${route}`)
    })
    global.__musicPlatformFactory__ = { getPlatform: () => ({ callModule }) }
    const artistIds = new Set()
    const first = new QQClient('uin=o123; qm_keyst=key', new Set(), artistIds, new Set())
    await first.favoriteArtist('artist-mid', true)

    const second = new QQClient('uin=o123; qm_keyst=key', new Set(), artistIds, new Set())
    await expect(second.getArtistDetail('artist-mid', 0)).resolves.toMatchObject({ favorite: true })
    expect(callModule.mock.calls.map(([route]) => route)).toEqual(['artist/sub', 'artist/detail'])
  })

  test.each([
    ['Netease', NeteaseClient, 'MUSIC_U=music-u'],
    ['QQ', QQClient, 'uin=o123; qm_keyst=key']
  ])('%s 重取四类用户列表后完整替换账号缓存', async (platform, Client, cookie) => {
    let phase = 1
    const likedName = platform === 'QQ' ? '我喜欢' : '我喜欢的音乐'
    const callModule = jest.fn((route) => {
      if (route === 'user/playlist') {
        return Promise.resolve({ code: 200, playlist: [{ id: 100 + phase, name: likedName, trackCount: 1, subscribed: false, ...(platform === 'QQ' ? { dirId: 201 } : { specialType: 5 }) }], more: false })
      }
      if (route === 'playlist/detail') {
        const song = { id: `track-${phase}`, mid: `track-${phase}`, name: '歌曲', ar: [], al: {} }
        return Promise.resolve({ code: 200, playlist: { id: 100 + phase, name: likedName, tracks: [song] } })
      }
      if (route === 'artist/sublist') return Promise.resolve({ code: 200, data: [{ id: `artist-${phase}`, name: '艺人' }], more: false })
      if (route === 'album/sublist') return Promise.resolve({ code: 200, data: [{ id: 200 + phase, name: '专辑' }], more: false })
      throw new Error(`unexpected route: ${route}`)
    })
    global.__musicPlatformFactory__ = { getPlatform: () => ({ callModule }) }
    const tracks = new Set(['old-track'])
    const artists = new Set(['old-artist'])
    const albums = new Set(['old-album'])
    const playlists = new Set(['old-playlist'])
    const client = new Client(cookie, tracks, artists, albums, playlists)

    for (const expected of [1, 2]) {
      phase = expected
      await client.getUserPlaylist()
      await client.userFavoriteTracks()
      await client.userArtists()
      await client.userAlbums()
      expect([...tracks]).toEqual([`track-${expected}`])
      expect([...playlists]).toEqual([String(100 + expected)])
      expect([...artists]).toEqual([`artist-${expected}`])
      expect([...albums]).toEqual([String(200 + expected)])
    }
  })

  test('网易云歌单跨页全部读取后才替换缓存，失败时保留旧缓存', async () => {
    let failSecondPage = true
    const callModule = jest.fn((route, { query }) => {
      expect(route).toBe('user/playlist')
      if (query.offset === 1000 && failSecondPage) return Promise.reject(new Error('page failed'))
      return Promise.resolve({
        code: 200,
        playlist: [{ id: query.offset === 0 ? 1 : 2, name: '歌单' }],
        more: query.offset === 0
      })
    })
    global.__musicPlatformFactory__ = { getPlatform: () => ({ callModule }) }
    const playlists = new Set(['old-playlist'])
    const client = new NeteaseClient('MUSIC_U=music-u', new Set(), new Set(), new Set(), playlists)

    await expect(client.getUserPlaylist()).rejects.toThrow('page failed')
    expect([...playlists]).toEqual(['old-playlist'])
    failSecondPage = false
    await expect(client.getUserPlaylist()).resolves.toMatchObject([{ id: '1' }, { id: '2' }])
    expect([...playlists]).toEqual(['1', '2'])
  })
})
