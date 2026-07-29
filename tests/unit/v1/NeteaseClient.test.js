const { NeteaseClient } = require('../../../dist/clients/NeteaseClient')

describe('NeteaseClient', () => {
  beforeEach(() => {
    global.__musicPlatformFactory__ = {
      getPlatform: jest.fn(() => ({ callModule: jest.fn() }))
    }
  })

  afterEach(() => {
    delete global.__musicPlatformFactory__
  })

  test('getTrackUrl 兼容 song_url_v1 实际返回结构', async () => {
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
    expect(callModule).toHaveBeenCalledWith('song/url/v1', expect.objectContaining({
      query: expect.objectContaining({
        id: '33418857',
        MUSIC_U: 'music-u',
        platform: 'netease'
      })
    }))
    expect(callModule).not.toHaveBeenCalledWith('lyric', expect.anything())
    expect(callModule).not.toHaveBeenCalledWith('lyric/new', expect.anything())
  })

  test('getTrackLyric 返回逐行与逐字歌词', async () => {
    const callModule = jest.fn((route) => {
      if (route === 'lyric') return Promise.resolve({ code: 200, lrc: { lyric: '逐行歌词' } })
      if (route === 'lyric/new') {
        return Promise.resolve({
          code: 200,
          yrc: { lyric: '{"t":0,"c":[{"tx":"作词"}]}\n[0,1000](0,500,0)歌(500,500,0)词' }
        })
      }
      return Promise.resolve({ code: 200 })
    })
    global.__musicPlatformFactory__.getPlatform.mockReturnValue({ callModule })

    const client = new NeteaseClient('MUSIC_U=music-u')
    await expect(client.getTrackLyric('33418857')).resolves.toEqual({
      lyric: '逐行歌词',
      wordLyric: '[0,1000](0,500,0)歌(500,500,0)词',
      translateLyric: '',
      translateWordLyric: ''
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
