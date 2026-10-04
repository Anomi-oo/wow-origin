jest.mock('axios', () => ({ default: { post: jest.fn() } }))
jest.mock('../../../platforms/qqmusic/util/android-login', () => ({ getAndroidLoginContext: jest.fn() }))

const { default: axios } = require('axios')
const { getAndroidLoginContext } = require('../../../platforms/qqmusic/util/android-login')
const personalized = require('../../../platforms/qqmusic/module/personalized')
const songDetail = require('../../../platforms/qqmusic/module/song_detail')
const songUrl = require('../../../platforms/qqmusic/module/song_url')
const similarTrack = require('../../../platforms/qqmusic/module/similar_track')
const artistTracks = require('../../../platforms/qqmusic/module/artist_tracks')
const topPlaylist = require('../../../platforms/qqmusic/module/top_playlist')
const { getQualityMap } = require('../../../platforms/qqmusic/config')
const { getQualityOptions } = require('../../../dist/quality')

describe('QQMusic v1 依赖模块', () => {
  test('推荐歌单向 QQ 上游传递 offset 和 limit', async () => {
    const request = jest.fn().mockResolvedValue({ body: { List: [] } })
    await personalized({ offset: 40, limit: 20 }, request)

    expect(request).toHaveBeenCalledWith(
      'music.playlist.PlaylistSquare',
      'GetRecommendFeed',
      { From: 40, Size: 20 },
      expect.any(Object)
    )
  })

  test('歌曲详情支持通过 mid 查询', async () => {
    const request = jest.fn().mockResolvedValue({
      body: {
        track_info: {
          id: 1,
          mid: 'songMid',
          name: '歌曲',
          singer: [],
          album: {},
          file: {
            size_128mp3: 100,
            size_192aac: 200,
            size_320mp3: 300,
            size_flac: 400,
            size_new: [800, 500, 600],
            size_dolby: 700
          }
        }
      }
    })
    const result = await songDetail({ mid: 'songMid' }, request)

    expect(request).toHaveBeenCalledWith(
      'music.pf_song_detail_svr',
      'get_song_detail_yqq',
      { song_mid: 'songMid', song_type: 0, song_id: 0 },
      expect.any(Object)
    )
    expect(result.songs[0]).toMatchObject({ mid: 'songMid', name: '歌曲' })
    expect(result.songs[0].qualities).toEqual([
      expect.objectContaining({ key: 'standard', label: '标准' }),
      expect.objectContaining({ key: 'higher', label: '高品质' }),
      expect.objectContaining({ key: 'exhigh', label: 'HQ 高品质' }),
      expect.objectContaining({ key: 'lossless', label: 'SQ 无损品质' }),
      expect.objectContaining({ key: 'atmos2', label: '臻品音质', size: 500 }),
      expect.objectContaining({ key: 'atmos51', label: '臻品全景声 5.1', size: 600 }),
      expect.objectContaining({ key: 'dolby', label: '杜比全景声', size: 700, format: 'mp4' }),
      expect.objectContaining({ key: 'master', label: '臻品母带', size: 800 })
    ])
  })

  test('相似歌曲模块使用数字 id 并将结果统一为 mid', async () => {
    const request = jest.fn().mockResolvedValue({
      body: {
        songInfoList: [{
          id: 2,
          mid: 'similarMid',
          name: '相似歌曲',
          singer: [],
          album: {},
          file: {}
        }]
      }
    })

    const result = await similarTrack({ id: 1, uin: '123', qm_keyst: 'key' }, request)

    expect(request).toHaveBeenCalledWith(
      'rcmusic.similarSongRadioServer',
      'get_simsongs',
      { songid: 1 },
      { uin: '123', qm_keyst: 'key' }
    )
    expect(result.songs[0]).toMatchObject({ id: 2, mid: 'similarMid', name: '相似歌曲' })
  })

  test('QQ status qualityMap 与歌曲详情音质文案一致', () => {
    const detailQualityMap = getQualityMap()
    const statusQualityMap = getQualityOptions('qq')

    expect(Object.fromEntries(statusQualityMap.map(option => [option.key, option.label]))).toEqual(
      Object.fromEntries(Object.entries(detailQualityMap).map(([key, option]) => [key, option.name]))
    )
  })

  test('QQ 返回空 purl 时不生成伪播放地址', async () => {
    axios.post.mockResolvedValue({ data: { req_1: { data: { midurlinfo: [{ purl: '' }] } } } })
    const result = await songUrl({ mid: 'songMid', level: 'standard' })

    expect(result.data[0].url).toBe('')
  })

  test.each([
    ['atmos2', 'Q000', '.flac', 'flac'],
    ['atmos51', 'Q001', '.flac', 'flac'],
    ['dolby', 'D004', '.mp4', 'mp4'],
    ['master', 'AI00', '.flac', 'flac']
  ])('%s 使用对应的 QQ 音频文件类型', async (level, prefix, suffix, format) => {
    const androidLoginCgi = jest.fn().mockResolvedValue({
      code: 0, data: { midurlinfo: [{ purl: `${prefix}songMidsongMid${suffix}` }] }
    })
    getAndroidLoginContext.mockReturnValue({ androidLoginCgi })

    const result = await songUrl({ mid: 'songMid', level, uin: '123', qm_keyst: 'key', loginType: '2', qq_android_identity: 'saved-state' })
    const [module, method, param, credential] = androidLoginCgi.mock.calls[0]

    expect(getAndroidLoginContext).toHaveBeenCalledWith('123', 'saved-state', { requireExisting: true })
    expect([module, method]).toEqual(['music.vkey.GetVkey', 'UrlGetVkey'])
    expect(param).toMatchObject({ filename: [`${prefix}songMidsongMid${suffix}`], songmid: ['songMid'], songtype: [0], ctx: 0 })
    expect(param.guid).toMatch(/^[a-f0-9]{32}$/)
    expect(credential).toEqual({ musicid: '123', musickey: 'key', loginType: 2 })
    expect(result.data[0]).toMatchObject({ level, type: format, url: `https://isure.stream.qqmusic.qq.com/${prefix}songMidsongMid${suffix}` })
  })

  test('QQ 上游为母带请求返回 SQ 文件时按实际文件标记音质', async () => {
    const androidLoginCgi = jest.fn().mockResolvedValue({
      code: 0, data: { midurlinfo: [{ purl: 'F000songMidsongMid.flac?vkey=token' }] }
    })
    getAndroidLoginContext.mockReturnValue({ androidLoginCgi })

    const result = await songUrl({ mid: 'songMid', level: 'master', uin: '123', qm_keyst: 'key', qq_android_identity: 'saved-state' })

    expect(result.data[0]).toMatchObject({ level: 'lossless', type: 'flac', br: null })
  })

  test('歌手歌曲列表使用 artist_tracks 模块请求 QQ 歌曲列表', async () => {
    const request = jest.fn().mockResolvedValue({
      body: {
        songList: [
          {
            songInfo: {
              id: 1,
              mid: 'songMid',
              name: '歌曲',
              singer: [{ mid: 'artistMid', name: '歌手' }],
              album: { id: 2, mid: 'albumMid', name: '专辑' },
              interval: 180
            }
          }
        ],
        totalNum: 20
      }
    })
    const result = await artistTracks({ id: 'artistMid', order: 'time', offset: 5, limit: 10 }, request)

    expect(request).toHaveBeenCalledWith(
      'music.musichallSong.SongListInter',
      'GetSingerSongList',
      { singerMid: 'artistMid', begin: 5, num: 10, order: 2 },
      expect.any(Object)
    )
    expect(result.songs[0]).toMatchObject({ mid: 'songMid', name: '歌曲' })
    expect(result.total).toBe(20)
  })

  test('分类歌单模块支持数字 category 直传给 QQ 上游', async () => {
    const request = jest.fn().mockResolvedValue({
      body: {
        content: {
          v_item: [],
          total_cnt: 0
        }
      }
    })

    await topPlaylist({ category: '3317', offset: 0, limit: 20 }, request)

    expect(request).toHaveBeenCalledWith(
      'music.playlist.PlayListCategory',
      'get_category_content',
      expect.objectContaining({ category_id: 3317 }),
      expect.any(Object)
    )
  })
})
