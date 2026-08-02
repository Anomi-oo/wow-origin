const { QQClient, getQualityCandidates, normalizeQQCredentials } = require('../../../dist/clients/QQClient')

describe('QQClient', () => {
  beforeEach(() => {
    global.__musicPlatformFactory__ = {
      getPlatform: jest.fn(() => ({ callModule: jest.fn() }))
    }
  })

  afterEach(() => {
    delete global.__musicPlatformFactory__
  })

  test('从 cookie 解析 QQ 凭证', () => {
    expect(normalizeQQCredentials('uin=o123456; qm_keyst=abc')).toEqual({
      uin: '123456',
      qm_keyst: 'abc'
    })
  })

  test('getTrackDetail 读取统一路由并返回原始 ID', async () => {
    const callModule = jest.fn().mockResolvedValue({
      code: 200,
      songs: [{ mid: 'mid', name: '歌曲', ar: [], al: {} }]
    })
    global.__musicPlatformFactory__.getPlatform.mockReturnValue({ callModule })

    const client = new QQClient('uin=o123; qm_keyst=key')
    const result = await client.getTrackDetail('mid')

    expect(callModule).toHaveBeenCalledWith('song/detail', expect.objectContaining({
      query: expect.objectContaining({
        mid: 'mid',
        ids: 'mid',
        uin: '123',
        qm_keyst: 'key',
        platform: 'qqmusic'
      })
    }))
    expect(result).toMatchObject({ id: 'mid', title: '歌曲' })
  })

  test('getSimilarTracks 先通过 mid 获取数字 id，再调用相似歌曲模块', async () => {
    const callModule = jest.fn((route) => {
      if (route === 'song/detail') {
        return Promise.resolve({
          code: 200,
          songs: [{ id: 12345, mid: 'seedMid', name: '种子歌曲', ar: [], al: {} }]
        })
      }
      if (route === 'similar/track') {
        return Promise.resolve({
          code: 200,
          songs: [{ id: 67890, mid: 'similarMid', name: '相似歌曲', ar: [], al: {} }]
        })
      }
      return Promise.resolve({ code: 200 })
    })
    global.__musicPlatformFactory__.getPlatform.mockReturnValue({ callModule })

    const client = new QQClient('uin=o123; qm_keyst=key')
    const tracks = await client.getSimilarTracks('seedMid')

    expect(callModule).toHaveBeenNthCalledWith(1, 'song/detail', expect.objectContaining({
      query: expect.objectContaining({ mid: 'seedMid' })
    }))
    expect(callModule).toHaveBeenNthCalledWith(2, 'similar/track', expect.objectContaining({
      query: expect.objectContaining({ id: 12345 })
    }))
    expect(tracks).toHaveLength(1)
    expect(tracks[0]).toMatchObject({ id: 'similarMid', title: '相似歌曲' })
  })

  test('getTrackUrl 只请求并返回音频地址', async () => {
    const callModule = jest.fn((route) => {
      if (route === 'lyric') {
        return Promise.resolve({ code: 200, lrc: { lyric: '逐行歌词' } })
      }
      if (route === 'lyric/new') {
        return Promise.resolve({ code: 200, yrc: { lyric: '[0,1000]歌(0,500)词(500,500)' } })
      }
      return Promise.resolve({ code: 200, data: [{ url: 'https://audio', level: 'exhigh', type: 'mp3' }] })
    })
    global.__musicPlatformFactory__.getPlatform.mockReturnValue({ callModule })

    const client = new QQClient('uin=o123; qm_keyst=key')
    const result = await client.getTrackUrl('mid', 'exhigh')

    expect(result).toMatchObject({
      url: 'https://audio',
      quality: 'exhigh'
    })
    expect(callModule).not.toHaveBeenCalledWith('lyric', expect.anything())
    expect(callModule).not.toHaveBeenCalledWith('lyric/new', expect.anything())
  })

  test('getTrackLyrics 并发聚合逐行与逐字歌词', async () => {
    let releaseLineLyrics
    let releaseWordLyrics
    const lineLyrics = new Promise((resolve) => { releaseLineLyrics = resolve })
    const wordLyrics = new Promise((resolve) => { releaseWordLyrics = resolve })
    const callModule = jest.fn((route) => {
      if (route === 'lyric') return lineLyrics
      if (route === 'lyric/new') return wordLyrics
      return Promise.resolve({ code: 200 })
    })
    global.__musicPlatformFactory__.getPlatform.mockReturnValue({ callModule })

    const client = new QQClient('uin=o123; qm_keyst=key')
    const resultPromise = client.getTrackLyrics('mid')
    await Promise.resolve()
    expect(callModule).toHaveBeenCalledWith('lyric', expect.any(Object))
    expect(callModule).toHaveBeenCalledWith('lyric/new', expect.any(Object))
    releaseLineLyrics({
      code: 200,
      lrc: { lyric: '逐行歌词' },
      tlyric: { lyric: '逐行翻译' }
    })
    releaseWordLyrics({ code: 200, yrc: { lyric: '[0,1000]歌(0,500)词(500,500)' } })

    await expect(resultPromise).resolves.toEqual({
      lyrics: '逐行歌词',
      wordLyrics: '[0,1000]歌(0,500)词(500,500)',
      translatedLyrics: '逐行翻译'
    })
  })

  test('逐字歌词请求失败时 getTrackLyrics 仍返回逐行歌词', async () => {
    const callModule = jest.fn((route) => {
      if (route === 'lyric') return Promise.resolve({ code: 200, lrc: { lyric: '逐行歌词' } })
      if (route === 'lyric/new') return Promise.reject(new Error('QRC unavailable'))
      return Promise.resolve({ code: 200 })
    })
    global.__musicPlatformFactory__.getPlatform.mockReturnValue({ callModule })

    const client = new QQClient('uin=o123; qm_keyst=key')
    await expect(client.getTrackLyrics('mid')).resolves.toMatchObject({
      lyrics: '逐行歌词',
      wordLyrics: ''
    })
  })

  test('favoriteTrack 使用目标状态和歌曲详情解析原始 ID，请求收藏后仍用 mid 维护本地收藏集', async () => {
    const favoriteTrackIds = new Set()
    const callModule = jest.fn((route) => {
      if (route === 'song/detail') {
        return Promise.resolve({
          code: 200,
          songs: [{ id: 12345, mid: '002G0sJY2wThyx', name: '歌曲', ar: [], al: {} }]
        })
      }
      if (route === 'like') {
        return Promise.resolve({ code: 200, result: { tid: 12345 } })
      }
      return Promise.resolve({ code: 200 })
    })
    global.__musicPlatformFactory__.getPlatform.mockReturnValue({ callModule })

    const client = new QQClient('uin=o123; qm_keyst=key', favoriteTrackIds)
    const result = await client.favoriteTrack('002G0sJY2wThyx', true)

    expect(result).toEqual({ success: true, status: true })
    expect(callModule).toHaveBeenCalledWith('song/detail', expect.objectContaining({
      query: expect.objectContaining({
        mid: '002G0sJY2wThyx',
        uin: '123',
        qm_keyst: 'key',
        platform: 'qqmusic'
      })
    }))
    expect(callModule).toHaveBeenCalledWith('like', expect.objectContaining({
      query: expect.objectContaining({
        id: 12345,
        like: 'true',
        uin: '123',
        qm_keyst: 'key',
        platform: 'qqmusic'
      })
    }))
    expect(favoriteTrackIds.has('002G0sJY2wThyx')).toBe(true)
    expect(favoriteTrackIds.has('12345')).toBe(false)
  })

  test('favoriteTrack 收藏更新失败时保持原收藏状态', async () => {
    const favoriteTrackIds = new Set()
    const callModule = jest.fn((route) => {
      if (route === 'song/detail') {
        return Promise.resolve({
          code: 200,
          songs: [{ id: 12345, mid: '002G0sJY2wThyx', name: '歌曲', ar: [], al: {} }]
        })
      }
      if (route === 'like') {
        return Promise.resolve({ code: 200, result: { tid: 0 } })
      }
      return Promise.resolve({ code: 200 })
    })
    global.__musicPlatformFactory__.getPlatform.mockReturnValue({ callModule })

    const client = new QQClient('uin=o123; qm_keyst=key', favoriteTrackIds)
    const result = await client.favoriteTrack('002G0sJY2wThyx', true)

    expect(result).toEqual({ success: false, status: false })
    expect(favoriteTrackIds.has('002G0sJY2wThyx')).toBe(false)
  })

  test('addTrackToPlaylist 使用歌曲详情解析原始 ID 后写入歌单', async () => {
    const callModule = jest.fn((route) => {
      if (route === 'song/detail') {
        return Promise.resolve({
          code: 200,
          songs: [{ id: 12345, mid: '002G0sJY2wThyx', name: '歌曲', ar: [], al: {} }]
        })
      }
      if (route === 'playlist/tracks') {
        return Promise.resolve({ code: 200, body: { code: 200, retCode: 0 } })
      }
      return Promise.resolve({ code: 200 })
    })
    global.__musicPlatformFactory__.getPlatform.mockReturnValue({ callModule })

    const client = new QQClient('uin=o123; qm_keyst=key')
    const result = await client.addTrackToPlaylist('987', '002G0sJY2wThyx')

    expect(result).toEqual({ success: true })
    expect(callModule).toHaveBeenCalledWith('song/detail', expect.objectContaining({
      query: expect.objectContaining({ mid: '002G0sJY2wThyx' })
    }))
    expect(callModule).toHaveBeenCalledWith('playlist/tracks', expect.objectContaining({
      query: expect.objectContaining({
        pid: '987',
        tracks: '12345',
        op: 'add'
      })
    }))
  })

  test('removeTrack 使用 numeric song id 删除歌单歌曲', async () => {
    const callModule = jest.fn((route) => {
      if (route === 'playlist/tracks') {
        return Promise.resolve({ code: 200, body: { code: 200, retCode: 0 } })
      }
      return Promise.resolve({ code: 200 })
    })
    global.__musicPlatformFactory__.getPlatform.mockReturnValue({ callModule })

    const client = new QQClient('uin=o123; qm_keyst=key')
    await client.removeTrack('987', '12345')

    expect(callModule).not.toHaveBeenCalledWith('song/detail', expect.any(Object))
    expect(callModule).toHaveBeenCalledWith('playlist/tracks', expect.objectContaining({
      query: expect.objectContaining({
        pid: '987',
        tracks: '12345',
        op: 'del'
      })
    }))
  })

  test('favoritePlaylist 调用 QQ 歌单收藏模块', async () => {
    const callModule = jest.fn((route) => {
      if (route === 'playlist/subscribe') {
        return Promise.resolve({ code: 200, success: true })
      }
      return Promise.resolve({ code: 200 })
    })
    global.__musicPlatformFactory__.getPlatform.mockReturnValue({ callModule })

    const client = new QQClient('uin=o123; qm_keyst=key')
    const result = await client.favoritePlaylist('987', false)

    expect(callModule).toHaveBeenCalledWith('playlist/subscribe', expect.objectContaining({
      query: expect.objectContaining({
        id: '987',
        t: 0
      })
    }))
    expect(result).toEqual({ success: true, status: false })
  })

  test('userFavoriteTracks 通过我喜欢歌单详情获取收藏歌曲，不再请求歌曲详情', async () => {
    const favoriteTrackIds = new Set()
    const callModule = jest.fn((route, options) => {
      if (route === 'user/playlist') {
        return Promise.resolve({
          code: 200,
          playlist: [
            { id: 1824599357, name: '我喜欢', trackCount: 2, creator: {} },
            { id: 999, name: '我喜欢', trackCount: 1, creator: {} }
          ]
        })
      }
      if (route === 'playlist/detail') {
        expect(options.query.id).toBe('1824599357')
        return Promise.resolve({
          code: 200,
          playlist: {
            id: 1824599357,
            name: '我喜欢',
            trackCount: 2,
            creator: {},
            tracks: [
              { mid: '002G0sJY2wThyx', name: '歌曲 A', ar: [], al: {} },
              { mid: '003H0tKZ3xUiay', name: '歌曲 B', ar: [], al: {} }
            ]
          }
        })
      }
      return Promise.resolve({ code: 200 })
    })
    global.__musicPlatformFactory__.getPlatform.mockReturnValue({ callModule })

    const client = new QQClient('uin=o123; qm_keyst=key', favoriteTrackIds)
    const tracks = await client.userFavoriteTracks()

    expect(tracks.map((track) => track.id)).toEqual(['002G0sJY2wThyx', '003H0tKZ3xUiay'])
    expect(tracks.every((track) => track.favorite)).toBe(true)
    expect(favoriteTrackIds.has('002G0sJY2wThyx')).toBe(true)
    expect(favoriteTrackIds.has('003H0tKZ3xUiay')).toBe(true)
    expect(callModule).toHaveBeenCalledWith('user/playlist', expect.objectContaining({
      query: expect.objectContaining({
        uin: '123',
        qm_keyst: 'key',
        platform: 'qqmusic'
      })
    }))
    expect(callModule).toHaveBeenCalledWith('playlist/detail', expect.objectContaining({
      query: expect.objectContaining({
        id: '1824599357',
        platform: 'qqmusic'
      })
    }))
    expect(callModule).not.toHaveBeenCalledWith('likelist', expect.any(Object))
    expect(callModule).not.toHaveBeenCalledWith('song/detail', expect.any(Object))
  })

  test('自动音质候选顺序稳定，显式音质不触发降级', () => {
    expect(getQualityCandidates('max')).toEqual(['lossless', 'exhigh', 'higher', 'standard'])
    expect(getQualityCandidates('min')).toEqual(['standard', 'higher', 'exhigh', 'lossless'])
    expect(getQualityCandidates('lossless')).toEqual(['lossless'])
  })

  test('歌单分类按 QQ 配置反转后的 key 顺序返回', async () => {
    const client = new QQClient('uin=o123; qm_keyst=key')
    const categories = await client.getPlaylistCategories()

    expect(categories.slice(0, 3)).toEqual([
      { key: '3317', label: '官方歌单' },
      { key: '9527', label: 'AI歌单' },
      { key: '3417', label: '私藏' }
    ])
  })

  test('分类歌单将数字 category 直传给 QQ top_playlist 模块', async () => {
    const callModule = jest.fn().mockResolvedValue({
      code: 200,
      playlists: []
    })
    global.__musicPlatformFactory__.getPlatform.mockReturnValue({ callModule })

    const client = new QQClient('uin=o123; qm_keyst=key')
    await client.getPlaylists(0, 20, '3317')

    expect(callModule).toHaveBeenCalledWith('top/playlist', expect.objectContaining({
      query: expect.objectContaining({
        category: '3317',
        platform: 'qqmusic'
      })
    }))
  })

  test('新增榜单接口调用对应 QQ 模块', async () => {
    const callModule = jest.fn((route) => {
      if (route === 'toplist/detail/v2') {
        return Promise.resolve({
          code: 200,
          data: [{
            name: '巅峰榜',
            list: [{
              topId: 26,
              title: '热歌榜',
              tracks: [
                { first: '第一首', second: '歌手 A' },
                { first: '第二首', second: '歌手 B' },
                { first: '第三首', second: '歌手 C' },
                { first: '第四首', second: '歌手 D' }
              ]
            }]
          }]
        })
      }
      if (route === 'toplist/songs/v2') {
        return Promise.resolve({
          code: 200,
          playlist: { id: 26, name: '热歌榜', coverImgUrl: '', trackCount: 300, creator: {}, tracks: [] }
        })
      }
      if (route === 'top/song') {
        return Promise.resolve({ code: 200, data: [] })
      }
      if (route === 'top/artists') {
        return Promise.resolve({ code: 200, artists: [] })
      }
      return Promise.resolve({ code: 200 })
    })
    global.__musicPlatformFactory__.getPlatform.mockReturnValue({ callModule })

    const client = new QQClient('uin=o123; qm_keyst=key')
    const toplists = await client.getToplist()
    const toplistDetail = await client.getToplistTracks('26', 0, 100)
    await client.getNewTracks()
    await client.getTopArtists()

    expect(toplists[0].list[0].tracks).toHaveLength(3)
    expect(toplists[0].list[0].tracks[0]).toEqual({ name: '第一首', artistName: '歌手 A' })
    expect(toplistDetail.trackCount).toBe(300)
    expect(callModule).toHaveBeenCalledWith('toplist/detail/v2', expect.any(Object))
    expect(callModule).toHaveBeenCalledWith('toplist/songs/v2', expect.objectContaining({
      query: expect.objectContaining({ topId: '26' })
    }))
    expect(callModule).toHaveBeenCalledWith('top/song', expect.any(Object))
    expect(callModule).toHaveBeenCalledWith('top/artists', expect.any(Object))
  })
})
