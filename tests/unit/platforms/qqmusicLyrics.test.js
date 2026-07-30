const lyric = require('../../../platforms/qqmusic/module/lyric')
const lyricNew = require('../../../platforms/qqmusic/module/lyric_new')

const QRC_FIXTURE = '0c8d67dd3e549974b64ed2680459f13881aa15d10db4cc8324b86311d0d741bd6af5d8724f2b75716c3a763afd2e129571af815a2be76f3587bfba344c3d5807e4a7705fee85ee3a0daa92650811905142f07887e05a5f84015edf5933646d88da8af1b6dd6ce63cb630c03cafb8b89b1f5715ee69f61281'

describe('QQ 歌词模块', () => {
  test('lyric 请求逐行 LRC 并解码 Base64', async () => {
    const request = jest.fn().mockResolvedValue({
      body: {
        lyric: Buffer.from('[00:01.00]歌词').toString('base64'),
        trans: Buffer.from('[00:01.00]翻译').toString('base64'),
        lrc_t: 12,
        trans_t: 13
      }
    })

    await expect(lyric({ id: 123 }, request)).resolves.toEqual({
      lrc: { version: 12, lyric: '[00:01.00]歌词' },
      tlyric: { version: 13, lyric: '[00:01.00]翻译' }
    })
    expect(request).toHaveBeenCalledWith(
      'music.musichallSong.PlayLyricInfo',
      'GetPlayLyricInfo',
      expect.objectContaining({ songID: 123, qrc: 0, trans: 1 }),
      expect.any(Object)
    )
  })

  test('lyric_new 请求 qrc=1 并提取 LyricContent', async () => {
    const request = jest.fn().mockResolvedValue({
      body: {
        lyric: QRC_FIXTURE,
        trans: Buffer.from('[00:01.00]翻译').toString('base64'),
        qrc: 1,
        qrc_t: 34,
        trans_t: 35
      }
    })

    await expect(lyricNew({ id: 123 }, request)).resolves.toEqual({
      yrc: { version: 34, lyric: '[0,1000]你(0,1000)' },
      tlyric: { version: 35, lyric: '[00:01.00]翻译' }
    })
    expect(request).toHaveBeenCalledWith(
      'music.musichallSong.PlayLyricInfo',
      'GetPlayLyricInfo',
      expect.objectContaining({ songID: 123, qrc: 1, trans: 1 }),
      expect.any(Object)
    )
  })

  test('XML 实体按顺序解码且缺少 QRC 时返回空歌词', async () => {
    expect(lyricNew.extractLyricContent(
      '<Lyric_1 LyricType="1" LyricContent="[0,1000]A&amp;B(0,1000)"/>'
    )).toBe('[0,1000]A&B(0,1000)')

    const request = jest.fn().mockResolvedValue({ body: { qrc: 0, lyric: '' } })
    await expect(lyricNew({ id: 123 }, request)).resolves.toEqual({
      yrc: { version: 0, lyric: '' }
    })
  })
})
