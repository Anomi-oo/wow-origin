const CloudStorage = require('../../../platforms/netease/cloud_storage')
const playlistDetail = require('../../../platforms/netease/module/playlist_detail')
const userPlaylist = require('../../../platforms/netease/module/user_playlist')

describe('NetEase cloud storage playlist', () => {
  test('云盘歌单使用稳定 ID 且不归属当前用户', () => {
    const playlist = new CloudStorage().createPlaylist()

    expect(playlist).toMatchObject({
      id: 'cloud-storage',
      name: '云盘音乐',
      description: '',
      coverImgUrl: 'https://ts4.tc.mm.bing.net/th/id/OIP-C.lHkJwZb2BkwjPGWKWbxCCQHaHa?r=0&rs=1&pid=ImgDetMain&o=7&rm=3',
      trackCount: 0,
      creator: { userId: '', nickname: '', avatarUrl: '' },
      subscribed: true
    })
  })

  test('用户歌单首页将云盘固定插入第二项', async () => {
    const request = jest.fn().mockResolvedValue({
      body: {
        code: 200,
        playlist: [
          { id: 1, name: '我喜欢的音乐', creator: { userId: 88 } },
          { id: 2, name: '自建歌单', creator: { userId: 88 } }
        ]
      }
    })

    const result = await userPlaylist({ uid: 88, limit: 2, offset: 0 }, request)

    expect(result.playlist.map(item => item.id)).toEqual([1, 'cloud-storage', 2])
    expect(result.total).toBe(3)
    expect(request).toHaveBeenCalledWith('/api/user/playlist', {
      uid: 88,
      limit: '2',
      offset: '0'
    }, expect.objectContaining({ crypto: 'eapi' }))
  })

  test('后续分页不重复插入云盘，且创建歌单筛选不包含云盘', async () => {
    const response = {
      body: {
        code: 200,
        playlist: [{ id: 2, name: '自建歌单', creator: { userId: 88 } }]
      }
    }
    const request = jest.fn().mockResolvedValue(response)

    await expect(userPlaylist({ uid: 88, limit: 1, offset: 1 }, request)).resolves.toMatchObject({
      playlist: [{ id: 2 }],
      total: 1
    })
    await expect(userPlaylist({ uid: 88, limit: 1, offset: 0, type: 1 }, request)).resolves.toMatchObject({
      playlist: [{ id: 2 }],
      total: 1
    })
  })

  test('云盘详情请求 user cloud 并映射 simpleSong', async () => {
    const request = jest.fn().mockResolvedValue({
      body: {
        code: 200,
        count: 12,
        data: [
          { simpleSong: { id: 101, name: '云盘歌曲 A' } },
          { simpleSong: { id: 102, name: '云盘歌曲 B' } }
        ]
      }
    })

    const result = await playlistDetail({ id: 'cloud-storage', n: 2, MUSIC_U: 'music-u' }, request)

    expect(result).toMatchObject({
      code: 200,
      playlist: {
        id: 'cloud-storage',
        trackCount: 12,
        tracks: [
          { id: 101, name: '云盘歌曲 A' },
          { id: 102, name: '云盘歌曲 B' }
        ]
      }
    })
    expect(request).toHaveBeenCalledWith('/api/v1/cloud/get', {
      limit: 2,
      offset: 0
    }, {
      crypto: 'weapi',
      useCheckToken: false,
      MUSIC_U: 'music-u'
    })
  })

  test('trackLimit=0 返回空歌曲列表但保留云盘总数', async () => {
    const request = jest.fn().mockResolvedValue({
      body: {
        code: 200,
        count: 8,
        data: [{ simpleSong: { id: 101, name: '云盘歌曲' } }]
      }
    })

    const result = await playlistDetail({ id: 'cloud-storage', n: 0 }, request)

    expect(result.playlist).toMatchObject({ trackCount: 8, tracks: [] })
    expect(request.mock.calls[0][1]).toEqual({ limit: 1, offset: 0 })
  })

  test('云盘无效响应向上抛错', async () => {
    const request = jest.fn().mockResolvedValue({ body: { code: 500 } })

    await expect(playlistDetail({ id: 'cloud-storage', n: 20 }, request))
      .rejects.toThrow('Cloud storage request failed')
  })

  test('普通歌单详情继续请求原有接口', async () => {
    const request = jest.fn().mockResolvedValue({
      body: { code: 200, playlist: { id: 123, tracks: [] } }
    })

    const result = await playlistDetail({ id: '123', n: 20, MUSIC_U: 'music-u' }, request)

    expect(result.playlist.id).toBe(123)
    expect(request).toHaveBeenCalledWith('/api/v6/playlist/detail', {
      id: '123',
      n: 20,
      s: 0
    }, {
      crypto: '',
      useCheckToken: false,
      MUSIC_U: 'music-u'
    })
  })
})
