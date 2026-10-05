const { QQClient } = require('../../../dist/clients/QQClient')
const { NeteaseClient } = require('../../../dist/clients/NeteaseClient')

const neteaseFields = { standard: 'l', exhigh: 'h', lossless: 'sq', hires: 'hr', jyeffect: 'je', sky: 'sk', master: 'jm' }

describe.each([
  ['QQ', QQClient, 'song/url', 'dolby', 'atmos2'],
  ['网易云', NeteaseClient, 'song/url/xeapi', 'master', 'hires']
])('%s 歌曲音质降级', (_label, Client, urlRoute, highQuality, intermediateQuality) => {
  let callModule
  let client

  function setup(available, playable, { errors = [], detailError, invalid = [] } = {}) {
    callModule = jest.fn(async (route, { query }) => {
      if (route === urlRoute) {
        if (errors.includes(query.level)) throw new Error(`failed ${query.level}`)
        return { code: 200, data: [{
          url: invalid.includes(query.level) ? 'invalid-url' : playable.includes(query.level) ? `https://audio.test/${query.level}` : null,
          level: query.level
        }] }
      }
      if (detailError) throw detailError
      if (route === 'song/music/detail') return { code: 200, data: {} }
      if (route === 'song/detail') {
        const track = Client === QQClient
          ? { mid: 'track', qualities: available.map((key) => ({ key, label: key, size: 100 })) }
          : { id: 'track', ...Object.fromEntries(available.map((key) => [neteaseFields[key] || key, { size: 100 }])) }
        return { code: 200, songs: [track] }
      }
      throw new Error(`unexpected route: ${route}`)
    })
    global.__musicPlatformFactory__ = { getPlatform: () => ({ callModule }) }
    client = new Client('')
  }

  const urlQualities = () => callModule.mock.calls.filter(([route]) => route === urlRoute).map(([, { query }]) => query.level)
  const detailCalls = () => callModule.mock.calls.filter(([route]) => route === 'song/detail')

  afterEach(() => { delete global.__musicPlatformFactory__ })

  test('请求成功时不额外获取详情', async () => {
    setup([], ['lossless'])
    await expect(client.getTrackUrl('track', 'lossless')).resolves.toMatchObject({ quality: 'lossless' })
    expect(urlQualities()).toEqual(['lossless'])
    expect(detailCalls()).toHaveLength(0)
  })

  test('高音质失败后选择歌曲中最近的中间档位，跳过不存在的 SQ', async () => {
    setup(['standard', 'exhigh', intermediateQuality], [intermediateQuality], { errors: [highQuality] })
    await expect(client.getTrackUrl('track', highQuality)).resolves.toMatchObject({ quality: intermediateQuality })
    expect(urlQualities()).toEqual([highQuality, intermediateQuality])
    expect(callModule.mock.calls[1][0]).toBe('song/detail')
    expect(detailCalls()).toHaveLength(1)
  })

  test('SQ 失败后只向下降至 HQ，不选择更高音质', async () => {
    setup(['master', intermediateQuality, 'standard', 'exhigh', 'lossless'], ['master', intermediateQuality, 'exhigh'])
    await expect(client.getTrackUrl('track', 'lossless')).resolves.toMatchObject({ quality: 'exhigh' })
    expect(urlQualities()).toEqual(['lossless', 'exhigh'])
    expect(detailCalls()).toHaveLength(1)
  })

  test('多次失败时逐档下降，整个流程只获取一次详情', async () => {
    setup(['standard', intermediateQuality, 'exhigh'], ['standard'], { errors: [intermediateQuality] })
    await expect(client.getTrackUrl('track', highQuality)).resolves.toMatchObject({ quality: 'standard' })
    expect(urlQualities()).toEqual([highQuality, intermediateQuality, 'exhigh', 'standard'])
    expect(detailCalls()).toHaveLength(1)
    if (Client === NeteaseClient) expect(callModule.mock.calls.filter(([route]) => route === 'song/music/detail')).toHaveLength(1)
  })

  test.each(['min', 'standard'])('%s 失败后不能向上选择', async (quality) => {
    setup(['master', 'lossless', 'exhigh'], ['master', 'lossless', 'exhigh'])
    await expect(client.getTrackUrl('track', quality)).rejects.toThrow('Song has no playable audio URL')
    expect(urlQualities()).toEqual(['standard'])
    expect(detailCalls()).toHaveLength(1)
  })

  test.each([undefined, 'max'])('自动音质 %s 失败后同样遵循歌曲音质表', async (quality) => {
    setup(['standard'], ['standard'])
    await expect(client.getTrackUrl('track', quality)).resolves.toMatchObject({ quality: 'standard' })
    expect(urlQualities()).toEqual([quality === 'max' ? 'master' : 'exhigh', 'standard'])
    expect(detailCalls()).toHaveLength(1)
  })

  test('详情查询失败时保留原始音频错误，不盲目尝试 SQ', async () => {
    setup([], [], { errors: [highQuality], detailError: new Error('detail unavailable') })
    await expect(client.getTrackUrl('track', highQuality)).rejects.toThrow(`failed ${highQuality}`)
    expect(urlQualities()).toEqual([highQuality])
    expect(detailCalls()).toHaveLength(1)
  })

  test.each([[[]], [['master']]])('没有更低可用档位时停止降级：%j', async (available) => {
    setup(available, ['master'])
    await expect(client.getTrackUrl('track', 'lossless')).rejects.toThrow('Song has no playable audio URL')
    expect(urlQualities()).toEqual(['lossless'])
  })

  test('无效播放链接也触发按歌曲音质表降级', async () => {
    setup(['exhigh'], ['exhigh'], { invalid: ['lossless'] })
    await expect(client.getTrackUrl('track', 'lossless')).resolves.toMatchObject({ quality: 'exhigh' })
    expect(urlQualities()).toEqual(['lossless', 'exhigh'])
  })

  test('所有低档位都失败时停止并保留原始错误', async () => {
    setup(['standard', 'exhigh'], [], { errors: ['lossless'] })
    await expect(client.getTrackUrl('track', 'lossless')).rejects.toThrow('failed lossless')
    expect(urlQualities()).toEqual(['lossless', 'exhigh', 'standard'])
    expect(detailCalls()).toHaveLength(1)
  })
})
