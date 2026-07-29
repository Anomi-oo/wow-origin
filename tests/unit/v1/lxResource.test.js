const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const {
  LxSourceManager,
  LxSourceRuntime,
  getLxSourceCachePath,
  loadLxSourceConfigs,
  md5,
  parseLxScriptInfo,
  selectLxQuality,
  millisecondsUntilNextOneAm
} = require('../../../dist/lx-resource')

const validScript = `/**
 * @name 测试源
 * @version 1.0.0
 */
const { EVENT_NAMES, on, send } = globalThis.lx
on(EVENT_NAMES.request, async ({ source, info }) => {
  const digest = globalThis.lx.utils.crypto.md5(String(info.musicInfo.songmid))
  return \`https://audio.test/\${source}/\${digest}/\${info.type}\`
})
send(EVENT_NAMES.inited, {
  sources: {
    tx: {
      name: 'QQ',
      type: 'music',
      actions: ['musicUrl'],
      qualitys: ['128k', '320k', 'flac']
    },
    wy: {
      name: '网易云',
      type: 'music',
      actions: ['musicUrl'],
      qualitys: ['128k', '320k']
    },
    kg: {
      name: '酷狗',
      type: 'music',
      actions: ['musicUrl'],
      qualitys: ['320k']
    }
  }
})
`

const createSourceScript = (name, resultExpression, platforms = ['tx']) => `/**
 * @name ${name}
 * @version 1.0.0
 */
const { EVENT_NAMES, on, send } = globalThis.lx
on(EVENT_NAMES.request, async ({ source, info }) => ${resultExpression})
send(EVENT_NAMES.inited, {
  sources: {
    ${platforms.map((platform) => `${platform}: {
      name: '${platform}',
      type: 'music',
      actions: ['musicUrl'],
      qualitys: ['128k', '320k', 'flac']
    }`).join(',')}
  }
})
`

describe('LX resource', () => {
  let temporaryDirectory

  beforeEach(async () => {
    temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'wow-lx-source-'))
    jest.spyOn(console, 'info').mockImplementation(() => {})
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(async () => {
    await fs.rm(temporaryDirectory, { recursive: true, force: true })
  })

  test('只按约定顺序读取无后缀与单数字环境变量', () => {
    const configs = loadLxSourceConfigs({
      LX_SOURCE_URL: 'https://source.test/base.js',
      LX_SOURCE_URL0: 'https://source.test/zero.js',
      LX_SOURCE_URL2: 'https://source.test/two.js',
      LX_SOURCE_URL9: 'https://source.test/base.js',
      LX_SOURCE_URL10: 'https://source.test/ten.js',
      LX_SOURCE_URL3: 'file:///tmp/source.js'
    })

    expect(configs.map(({ url }) => url)).toEqual([
      'https://source.test/base.js',
      'https://source.test/zero.js',
      'https://source.test/two.js'
    ])
    expect(configs.map(({ order }) => order)).toEqual([0, 1, 3])
  })

  test('每日更新按进程本地时间调度到下一个凌晨一点', () => {
    expect(millisecondsUntilNextOneAm(new Date(2026, 6, 26, 0, 30, 0))).toBe(30 * 60 * 1000)
    expect(millisecondsUntilNextOneAm(new Date(2026, 6, 26, 1, 0, 0))).toBe(24 * 60 * 60 * 1000)
  })

  test('解析源名称并按声明能力选择最近的较低音质', () => {
    expect(parseLxScriptInfo(validScript)).toEqual(expect.objectContaining({
      name: '测试源',
      version: '1.0.0'
    }))
    expect(selectLxQuality('higher', ['128k', '320k'])).toBe('320k')
    expect(selectLxQuality('lossless', ['128k', '320k'])).toBe('320k')
    expect(selectLxQuality('standard', ['320k'])).toBeUndefined()
    expect(selectLxQuality('max', ['128k', 'flac24bit'])).toBe('flac24bit')
    expect(parseLxScriptInfo(`/*!
      * @name 感叹号文件头
      */`).name).toBe('感叹号文件头')
  })

  test('Worker 兼容初始化、平台能力过滤和 crypto bridge', async () => {
    const sourceInfo = parseLxScriptInfo(validScript)
    const runtime = new LxSourceRuntime({ script: validScript, sourceInfo })

    try {
      const initialization = await runtime.initialize()
      expect(initialization.capabilities).toEqual({
        tx: {
          actions: ['musicUrl'],
          qualities: ['128k', '320k', 'flac']
        },
        wy: {
          actions: ['musicUrl'],
          qualities: ['128k', '320k']
        }
      })

      await expect(runtime.invoke({
        source: 'tx',
        quality: '320k',
        musicInfo: { songmid: 'track-1' },
        timeoutMs: 3000
      })).resolves.toBe(`https://audio.test/tx/${md5('track-1')}/320k`)
    } finally {
      await runtime.terminate()
    }
  })

  test('Worker 的 lx.request 提供官方响应结构', async () => {
    const responseBody = encodeURIComponent(JSON.stringify({
      url: 'https://audio.test/from-http.mp3'
    }))
    const script = createSourceScript(
      'HTTP源',
      `new Promise((resolve, reject) => {
        globalThis.lx.request(
          'data:application/json,${responseBody}',
          {},
          (error, response, body) => error ? reject(error) : resolve(response.body.url)
        )
      })`
    )
    const runtime = new LxSourceRuntime({ script, sourceInfo: parseLxScriptInfo(script) })

    try {
      await runtime.initialize()
      await expect(runtime.invoke({
        source: 'tx',
        quality: '320k',
        musicInfo: { songmid: 'track-1' },
        timeoutMs: 3000
      })).resolves.toBe('https://audio.test/from-http.mp3')
    } finally {
      await runtime.terminate()
    }
  })

  test('从 MD5 缓存异步注册并返回 Wow TrackUrl', async () => {
    const url = 'https://source.test/cached.js'
    const hash = md5(url)
    const cacheDirectory = path.join(temporaryDirectory, 'lx-sources')
    await fs.mkdir(cacheDirectory, { recursive: true })
    await fs.writeFile(getLxSourceCachePath(cacheDirectory, hash), validScript)
    const downloadSource = jest.fn()
    const manager = new LxSourceManager({
      configs: [{ url, hash, order: 0 }],
      cacheDirectory,
      downloadSource
    })

    try {
      manager.start()
      await manager.waitForInitialLoad()

      await expect(manager.resolveTrackUrl('qq', 'track-1', 'higher')).resolves.toEqual({
        url: `https://audio.test/tx/${md5('track-1')}/320k`,
        quality: 'exhigh',
        format: '',
        bitrate: 320000,
        size: 0
      })
      expect(downloadSource).not.toHaveBeenCalled()
    } finally {
      await manager.stop()
    }
  })

  test('缓存注册失败时重新下载并替换为可用脚本', async () => {
    const url = 'https://source.test/recover.js'
    const hash = md5(url)
    const cacheDirectory = path.join(temporaryDirectory, 'lx-sources')
    const cachePath = getLxSourceCachePath(cacheDirectory, hash)
    await fs.mkdir(cacheDirectory, { recursive: true })
    await fs.writeFile(cachePath, 'throw new Error("broken cache")')
    const downloadSource = jest.fn().mockResolvedValue(validScript)
    const manager = new LxSourceManager({
      configs: [{ url, hash, order: 0 }],
      cacheDirectory,
      downloadSource
    })

    try {
      manager.start()
      await manager.waitForInitialLoad()

      expect(downloadSource).toHaveBeenCalledWith(url)
      expect(await fs.readFile(cachePath, 'utf8')).toBe(validScript)
      await expect(manager.resolveTrackUrl('netease', '123', 'standard')).resolves.toEqual(
        expect.objectContaining({
          url: `https://audio.test/wy/${md5('123')}/128k`,
          quality: 'standard'
        })
      )
    } finally {
      await manager.stop()
    }
  })

  test('前一个源返回无效 URL 时按配置顺序尝试下一个源', async () => {
    const firstUrl = 'https://source.test/first.js'
    const secondUrl = 'https://source.test/second.js'
    const firstHash = md5(firstUrl)
    const secondHash = md5(secondUrl)
    const cacheDirectory = path.join(temporaryDirectory, 'lx-sources')
    await fs.mkdir(cacheDirectory, { recursive: true })
    await fs.writeFile(
      getLxSourceCachePath(cacheDirectory, firstHash),
      createSourceScript('失败源', `'not-a-url'`)
    )
    await fs.writeFile(
      getLxSourceCachePath(cacheDirectory, secondHash),
      createSourceScript('备用源', `'https://audio.test/backup/' + info.musicInfo.songmid`)
    )
    const manager = new LxSourceManager({
      configs: [
        { url: firstUrl, hash: firstHash, order: 0 },
        { url: secondUrl, hash: secondHash, order: 1 }
      ],
      cacheDirectory,
      downloadSource: jest.fn()
    })

    try {
      manager.start()
      await manager.waitForInitialLoad()
      await expect(manager.resolveTrackUrl('qq', 'track-2', 'higher')).resolves.toEqual(
        expect.objectContaining({
          url: 'https://audio.test/backup/track-2',
          quality: 'exhigh'
        })
      )
    } finally {
      await manager.stop()
    }
  })

  test('更新脚本校验成功后替换缓存和运行中的源', async () => {
    const url = 'https://source.test/update.js'
    const hash = md5(url)
    const cacheDirectory = path.join(temporaryDirectory, 'lx-sources')
    const cachePath = getLxSourceCachePath(cacheDirectory, hash)
    const oldScript = createSourceScript('旧源', `'https://audio.test/old/' + info.musicInfo.songmid`)
    const newScript = createSourceScript('新源', `'https://audio.test/new/' + info.musicInfo.songmid`)
    await fs.mkdir(cacheDirectory, { recursive: true })
    await fs.writeFile(cachePath, oldScript)
    const manager = new LxSourceManager({
      configs: [{ url, hash, order: 0 }],
      cacheDirectory,
      downloadSource: jest.fn().mockResolvedValue(newScript)
    })

    try {
      manager.start()
      await manager.waitForInitialLoad()
      await expect(manager.resolveTrackUrl('qq', 'track-3', 'higher')).resolves.toEqual(
        expect.objectContaining({ url: 'https://audio.test/old/track-3' })
      )

      await manager.updateAll()

      expect(await fs.readFile(cachePath, 'utf8')).toBe(newScript)
      await expect(manager.resolveTrackUrl('qq', 'track-3', 'higher')).resolves.toEqual(
        expect.objectContaining({ url: 'https://audio.test/new/track-3' })
      )
    } finally {
      await manager.stop()
    }
  })
})
