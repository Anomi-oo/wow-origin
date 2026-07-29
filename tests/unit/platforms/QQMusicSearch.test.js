jest.mock('axios', () => ({
  default: {
    get: jest.fn(),
    post: jest.fn()
  }
}))

const { default: axios } = require('axios')
const search = require('../../../platforms/qqmusic/module/search')

describe('QQMusic search fallback', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  test('新版歌曲搜索成功时不调用旧版 CGI，并保留总数', async () => {
    axios.post.mockResolvedValue({
      data: {
        code: 0,
        req_1: {
          code: 0,
          data: {
            meta: { sum: 100, nextpage: 2 },
            body: {
              song: {
                list: [{
                  id: 1,
                  mid: 'song-mid',
                  name: '歌曲',
                  singer: [{ mid: 'artist-mid', name: '歌手' }],
                  album: { id: 2, mid: 'album-mid', name: '专辑' },
                  interval: 180,
                  pay: { pay_play: 1 },
                  mv: { vid: 'mv-id' },
                  subtitle: ''
                }]
              }
            }
          }
        }
      }
    })

    const result = await search({ keywords: '歌曲', type: 1, offset: 0, limit: 20 })

    expect(result.result.songCount).toBe(100)
    expect(result.result.hasMore).toBe(true)
    expect(result.result.songs[0]).toMatchObject({
      id: 1,
      mid: 'song-mid',
      name: '歌曲',
      ar: [{ id: 'artist-mid', name: '歌手' }]
    })
    expect(axios.get).not.toHaveBeenCalled()
  })

  test('新版子请求返回 2001 时回退旧版歌曲 CGI', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    axios.post.mockResolvedValue({
      data: {
        code: 0,
        req_1: {
          code: 2001,
          data: {
            meta: { sum: 0 },
            body: { song: { list: [] } }
          }
        }
      }
    })
    axios.get.mockResolvedValue({
      data: {
        code: 0,
        data: {
          song: {
            curpage: 1,
            curnum: 1,
            totalnum: 30,
            list: [{
              songid: 1,
              songmid: 'legacy-song-mid',
              songname: '旧版歌曲',
              singer: [{ id: 2, mid: 'artist-mid', name: '歌手' }],
              albumid: 3,
              albummid: 'album-mid',
              albumname: '专辑',
              interval: 200,
              pay: { payplay: 1 },
              vid: 'mv-id'
            }]
          }
        }
      }
    })

    const result = await search({ keywords: '旧版歌曲', type: 1, offset: 0, limit: 20 })

    expect(axios.get).toHaveBeenCalledWith(
      'https://c.y.qq.com/soso/fcgi-bin/client_search_cp',
      expect.objectContaining({
        params: expect.objectContaining({ t: 0, w: '旧版歌曲', n: 20, p: 1 })
      })
    )
    expect(result.result.songCount).toBe(30)
    expect(result.result.songs[0]).toMatchObject({
      id: 1,
      mid: 'legacy-song-mid',
      name: '旧版歌曲',
      fee: 1
    })
  })

  test('新版网络失败时回退旧版专辑 CGI', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    axios.post.mockRejectedValue(new Error('network failed'))
    axios.get.mockResolvedValue({
      data: {
        code: 0,
        data: {
          album: {
            curpage: 1,
            curnum: 1,
            totalnum: 12,
            list: [{
              albumID: 10,
              albumMID: 'album-mid',
              albumName: '专辑',
              albumPic: 'https://image.test/album.jpg',
              singerName: '歌手',
              song_count: 8,
              publicTime: '2026-01-01'
            }]
          }
        }
      }
    })

    const result = await search({ keywords: '专辑', type: 10, offset: 0, limit: 10 })

    expect(axios.get).toHaveBeenCalledWith(
      'https://c.y.qq.com/soso/fcgi-bin/client_search_cp',
      expect.objectContaining({
        params: expect.objectContaining({ t: 8, w: '专辑' })
      })
    )
    expect(result.result.albumCount).toBe(12)
    expect(result.result.albums[0]).toMatchObject({
      id: 10,
      mid: 'album-mid',
      name: '专辑',
      artistName: '歌手'
    })
  })

  test('新版返回合法空结果时不回退', async () => {
    axios.post.mockResolvedValue({
      data: {
        code: 0,
        req_1: {
          code: 0,
          data: {
            meta: { sum: 0, nextpage: -1 },
            body: { album: { list: [] } }
          }
        }
      }
    })

    const result = await search({ keywords: '没有结果', type: 10, offset: 0, limit: 10 })

    expect(result.result.albums).toEqual([])
    expect(result.result.albumCount).toBe(0)
    expect(axios.get).not.toHaveBeenCalled()
  })

  test('新版歌单搜索失败时使用旧版歌单专用 CGI', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    axios.post.mockRejectedValue(new Error('network failed'))
    axios.get.mockResolvedValue({
      data: {
        code: 0,
        data: {
          display_num: 50,
          page_no: 0,
          num_per_page: 10,
          list: [{
            dissid: 'playlist-id',
            dissname: '歌单',
            imgurl: 'https://image.test/playlist.jpg',
            creator: { creator_uin: '1', name: '创建者' },
            song_count: 20,
            listennum: 100
          }]
        }
      }
    })

    const result = await search({ keywords: '歌单', type: 1000, offset: 0, limit: 10 })

    expect(axios.get).toHaveBeenCalledWith(
      'https://c.y.qq.com/soso/fcgi-bin/client_music_search_songlist',
      expect.objectContaining({
        params: expect.objectContaining({ query: '歌单', page_no: 0, num_per_page: 10 })
      })
    )
    expect(result.result.playlistCount).toBe(50)
    expect(result.result.playlists[0]).toMatchObject({
      id: 'playlist-id',
      name: '歌单',
      creator: { userId: '1', nickname: '创建者' }
    })
  })
})
