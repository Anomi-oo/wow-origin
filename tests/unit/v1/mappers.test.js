const qqMappers = require('../../../dist/mappers/qq')
const neteaseMappers = require('../../../dist/mappers/netease')

describe('v1 mappers', () => {
  test('统一歌单字段和秒级时间戳', () => {
    expect(qqMappers.mapPlaylist({
      id: 123,
      name: '推荐歌单',
      createTime: 100,
      creator: { userId: 456, nickname: '创建者' }
    })).toMatchObject({
      id: '123',
      name: '推荐歌单',
      createdAt: 100000,
      creator: { id: '456', name: '创建者' }
    })
  })

  test('歌曲优先使用 mid 作为原始 ID', () => {
    expect(qqMappers.mapTrack({
      id: 1,
      mid: 'songMid',
      name: '歌曲',
      ar: [{ id: 'artistMid', name: '歌手' }],
      al: { id: 2, mid: 'albumMid', name: '专辑' },
      dt: 3000
    })).toMatchObject({
      id: 'songMid',
      artists: [{ id: 'artistMid', name: '歌手' }],
      album: { id: '2', name: '专辑' },
      durationMs: 3000,
      favorite: false
    })
  })

  test('统一歌词和音频字段', () => {
    expect(qqMappers.mapLyrics({ lrc: { lyric: '原文' }, tlyric: { lyric: '翻译' } })).toEqual({
      original: '原文', translation: '翻译', romanized: ''
    })
    expect(qqMappers.mapTrackUrl({ url: 'https://audio', level: 'higher', type: 'm4a', br: 192000 })).toMatchObject({
      url: 'https://audio', quality: 'higher', format: 'm4a', bitrate: 192000
    })
  })

  test('播放歌词使用四字段结构并清理网易 JSON 元数据', () => {
    expect(qqMappers.mapTrackLyrics(
      { lrc: { lyric: 'QQ 逐行' }, tlyric: { lyric: 'QQ 翻译' } },
      { yrc: { lyric: '[0,1000]Q(0,500)Q(500,500)' } }
    )).toEqual({
      lyric: 'QQ 逐行',
      wordLyric: '[0,1000]Q(0,500)Q(500,500)',
      translateLyric: 'QQ 翻译',
      translateWordLyric: ''
    })

    expect(neteaseMappers.mapTrackLyrics(
      { lrc: { lyric: '网易逐行' }, tlyric: { lyric: '网易翻译' } },
      {
        yrc: { lyric: '{"t":0,"c":[{"tx":"作词"}]}\n[0,1000](0,1000,0)歌' },
        ytlrc: { lyric: '[0,1000](0,1000,0)译' }
      }
    )).toEqual({
      lyric: '网易逐行',
      wordLyric: '[0,1000](0,1000,0)歌',
      translateLyric: '网易翻译',
      translateWordLyric: '[0,1000](0,1000,0)译'
    })
  })

  test('网易映射返回原始 ID', () => {
    expect(neteaseMappers.mapTrack({
      id: 1,
      name: '歌曲',
      ar: [{ id: 2, name: '歌手' }],
      al: { id: 3, name: '专辑' },
      dt: 3000
    })).toMatchObject({
      id: '1',
      artists: [{ id: '2', name: '歌手' }],
      album: { id: '3', name: '专辑' },
      durationMs: 3000,
      favorite: false
    })
  })

  test('网易音质码率以 bps 返回', () => {
    expect(neteaseMappers.mapTrack({
      id: 1,
      name: '歌曲',
      ar: [],
      al: {},
      l: { br: 128000, size: 100 },
      h: { br: 320000, size: 200 }
    }).qualities).toEqual([
      expect.objectContaining({ key: 'standard', bitrate: 128000 }),
      expect.objectContaining({ key: 'exhigh', bitrate: 320000 })
    ])
  })
})
