const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  createAccountWithCookie,
  extractAuthorizationToken,
  generateAccountAccessKey,
  loadAccountSessions,
  normalizeAccountLxSources,
  updateAccountConfigByAccessKey,
  updateAccountCookieByAccessKey
} = require('../../../dist/accounts')

function makeWorkDir() {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'music-api-accounts-'))
  fs.mkdirSync(path.join(workDir, 'data'), { recursive: true })
  return workDir
}

describe('v1 accounts', () => {
  let warnSpy
  let errorSpy
  let logSpy

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
    errorSpy.mockRestore()
    logSpy.mockRestore()
  })

  test('解析 Authorization token', () => {
    expect(extractAuthorizationToken('Bearer abc')).toBe('abc')
    expect(extractAuthorizationToken('bearer abc')).toBe('abc')
    expect(extractAuthorizationToken('abc')).toBe('abc')
    expect(extractAuthorizationToken('')).toBe('')
  })

  test('缺失 accounts.json 时返回空 registry 并打印模板', () => {
    const registry = loadAccountSessions(makeWorkDir())

    expect(registry.sessions).toHaveLength(0)
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('accounts.json 不存在'))
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('accounts.json 配置模板'))
  })

  test('空文件和 JSON 解析失败不阻止加载', () => {
    const emptyDir = makeWorkDir()
    fs.writeFileSync(path.join(emptyDir, 'data', 'accounts.json'), '')
    expect(loadAccountSessions(emptyDir).sessions).toHaveLength(0)
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('内容为空'))

    const invalidDir = makeWorkDir()
    fs.writeFileSync(path.join(invalidDir, 'data', 'accounts.json'), '{')
    expect(loadAccountSessions(invalidDir).sessions).toHaveLength(0)
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('JSON 解析失败'), expect.any(Error))
  })

  test('忽略缺失或空 api_access_key 的账号', () => {
    const workDir = makeWorkDir()
    fs.writeFileSync(path.join(workDir, 'data', 'accounts.json'), JSON.stringify([
      { platform: 'qq', name: 'empty', cookie: 'cookie', api_access_key: '' },
      { platform: 'netease', name: 'missing', cookie: 'cookie' },
      { platform: 'qq', name: 'ok', cookie: 'cookie', api_access_key: 'key-ok' }
    ]))

    const registry = loadAccountSessions(workDir)

    expect(registry.sessions).toHaveLength(1)
    expect(registry.byAccessKey.get('key-ok').name).toBe('ok')
    expect(registry.byAccessKey.get('key-ok').stateless).toBe(true)
    expect(registry.byAccessKey.get('key-ok').useLuoxue).toBe(true)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('api_access_key 未填写或为空'))
  })

  test('解析 useLuoxue，缺失时默认启用', () => {
    const workDir = makeWorkDir()
    fs.writeFileSync(path.join(workDir, 'data', 'accounts.json'), JSON.stringify([
      { platform: 'qq', name: 'default', cookie: '', api_access_key: 'key-default' },
      { platform: 'qq', name: 'enabled', cookie: '', api_access_key: 'key-enabled', useLuoxue: true },
      { platform: 'netease', name: 'disabled', cookie: '', api_access_key: 'key-disabled', useLuoxue: false }
    ]))

    const registry = loadAccountSessions(workDir)

    expect(registry.byAccessKey.get('key-default').useLuoxue).toBe(true)
    expect(registry.byAccessKey.get('key-enabled').useLuoxue).toBe(true)
    expect(registry.byAccessKey.get('key-disabled').useLuoxue).toBe(false)
  })

  test('旧账号缺失 lxSource 时兼容为空数组，手工无效地址不会阻止加载', () => {
    const workDir = makeWorkDir()
    fs.writeFileSync(path.join(workDir, 'data', 'accounts.json'), JSON.stringify([
      { platform: 'qq', name: 'legacy', cookie: '', api_access_key: 'legacy-key' },
      {
        platform: 'netease', name: 'mixed', cookie: '', api_access_key: 'mixed-key',
        lxSource: ['https://example.com/a.js', 'file:///tmp/bad.js', 123]
      }
    ]))

    const registry = loadAccountSessions(workDir)

    expect(registry.byAccessKey.get('legacy-key').lxSource).toEqual([])
    expect(registry.byAccessKey.get('mixed-key').lxSource).toEqual(['https://example.com/a.js'])
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('无效的 lxSource'))
  })

  test('网页 lxSource 校验 HTTP(S) 且最多保留十个唯一地址', () => {
    expect(normalizeAccountLxSources([
      ' https://example.com/a.js ',
      'https://example.com/a.js',
      '',
      'http://example.com/b.js'
    ])).toEqual(['https://example.com/a.js', 'http://example.com/b.js'])
    expect(() => normalizeAccountLxSources(['file:///tmp/source.js'])).toThrow('地址无效')
    expect(() => normalizeAccountLxSources(
      Array.from({ length: 11 }, (_, index) => `https://example.com/${index}.js`)
    )).toThrow('最多配置 10 个')
  })

  test('useLuoxue 非 boolean 时保留账号、打印警告并按 false 处理', () => {
    const workDir = makeWorkDir()
    fs.writeFileSync(path.join(workDir, 'data', 'accounts.json'), JSON.stringify([
      { platform: 'qq', name: 'invalid', cookie: 'cookie', api_access_key: 'key-1', useLuoxue: 'false' }
    ]))

    const registry = loadAccountSessions(workDir)

    expect(registry.sessions).toHaveLength(1)
    expect(registry.byAccessKey.get('key-1').useLuoxue).toBe(false)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('useLuoxue 必须是 boolean'))
  })

  test('重复 api_access_key 的账号都不注册', () => {
    const workDir = makeWorkDir()
    fs.writeFileSync(path.join(workDir, 'data', 'accounts.json'), JSON.stringify([
      { platform: 'qq', name: 'qq1', cookie: 'cookie1', api_access_key: 'same' },
      { platform: 'netease', name: 'netease1', cookie: 'cookie2', api_access_key: 'same' },
      { platform: 'qq', name: 'qq2', cookie: 'cookie3', api_access_key: 'unique' }
    ]))

    const registry = loadAccountSessions(workDir)

    expect(registry.sessions.map((session) => session.name)).toEqual(['qq2'])
    expect(registry.byAccessKey.has('same')).toBe(false)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('api_access_key 重复'))
  })

  test('按 api_access_key 更新 cookie 并同步刷新 registry', () => {
    const workDir = makeWorkDir()
    const accountsPath = path.join(workDir, 'data', 'accounts.json')
    fs.writeFileSync(accountsPath, JSON.stringify([
      { platform: 'qq', name: 'qq1', cookie: 'old', api_access_key: 'key-1', stateless: false, useLuoxue: false },
      { platform: 'netease', name: 'netease1', cookie: 'old2', api_access_key: 'key-2' }
    ]))
    const registry = loadAccountSessions(workDir)

    const result = updateAccountCookieByAccessKey(
      'key-1',
      'qq',
      'MUSIC_U=new_cookie',
      registry,
      workDir
    )
    const saved = JSON.parse(fs.readFileSync(accountsPath, 'utf8'))

    expect(result.session.cookie).toBe('MUSIC_U=new_cookie')
    expect(result.session.platform).toBe('qq')
    expect(result.session.name).toBe('qq1')
    expect(result.session.stateless).toBe(false)
    expect(result.session.useLuoxue).toBe(false)
    expect(registry.byAccessKey.get('key-1').cookie).toBe('MUSIC_U=new_cookie')
    expect(registry.byAccessKey.get('key-1').name).toBe('qq1')
    expect(saved[0]).toMatchObject({
      platform: 'qq',
      name: 'qq1',
      cookie: 'MUSIC_U=new_cookie',
      api_access_key: 'key-1',
      stateless: false,
      useLuoxue: false
    })
    expect(saved[1].cookie).toBe('old2')
  })

  test('更新 cookie 时拒绝修改账号平台', () => {
    const workDir = makeWorkDir()
    fs.writeFileSync(path.join(workDir, 'data', 'accounts.json'), JSON.stringify([
      { platform: 'qq', name: 'qq1', cookie: 'old', api_access_key: 'key-1' }
    ]))
    const registry = loadAccountSessions(workDir)

    expect(() => updateAccountCookieByAccessKey('key-1', 'netease', 'new', registry, workDir))
      .toThrow('不能修改平台')
  })

  test('独立更新账号配置并规范化 lxSource', () => {
    const workDir = makeWorkDir()
    const accountsPath = path.join(workDir, 'data', 'accounts.json')
    fs.writeFileSync(accountsPath, JSON.stringify([
      { platform: 'qq', name: 'qq1', cookie: 'old', api_access_key: 'key-1' }
    ]))
    const registry = loadAccountSessions(workDir)

    const result = updateAccountConfigByAccessKey('key-1', {
      name: '新名称', stateless: false, useLuoxue: true,
      lxSource: [' https://example.com/a.js ', '', 'https://example.com/a.js']
    }, registry, workDir)

    expect(result.session).toMatchObject({
      platform: 'qq', name: '新名称', cookie: 'old', stateless: false,
      useLuoxue: true, lxSource: ['https://example.com/a.js']
    })
    expect(JSON.parse(fs.readFileSync(accountsPath, 'utf8'))[0].lxSource)
      .toEqual(['https://example.com/a.js'])
  })

  test('生成无短横线 api_access_key', () => {
    const workDir = makeWorkDir()
    fs.writeFileSync(path.join(workDir, 'data', 'accounts.json'), JSON.stringify([
      { platform: 'qq', name: 'qq1', cookie: 'old', api_access_key: 'key-1' }
    ]))
    const registry = loadAccountSessions(workDir)

    const key = generateAccountAccessKey(registry, workDir)

    expect(key).toMatch(/^[0-9a-f]{32}$/)
    expect(key).not.toContain('-')
    expect(key).not.toBe('key-1')
  })

  test('新增账号时追加写入 accounts.json 并同步 registry', () => {
    const workDir = makeWorkDir()
    const accountsPath = path.join(workDir, 'data', 'accounts.json')
    fs.writeFileSync(accountsPath, JSON.stringify([
      { platform: 'qq', name: 'qq1', cookie: 'old', api_access_key: 'key-1' }
    ]))
    const registry = loadAccountSessions(workDir)

    const result = createAccountWithCookie(
      'newkey',
      'netease',
      'MUSIC_U=new_cookie',
      registry,
      workDir,
      '网易昵称'
    )
    const saved = JSON.parse(fs.readFileSync(accountsPath, 'utf8'))

    expect(result.session).toMatchObject({
      platform: 'netease',
      name: '网易昵称',
      cookie: 'MUSIC_U=new_cookie',
      apiAccessKey: 'newkey',
      stateless: false,
      useLuoxue: true
    })
    expect(saved).toHaveLength(2)
    expect(saved[1]).toMatchObject({
      platform: 'netease',
      name: '网易昵称',
      cookie: 'MUSIC_U=new_cookie',
      api_access_key: 'newkey',
      stateless: false,
      useLuoxue: true
    })
    expect(registry.byAccessKey.get('newkey').name).toBe('网易昵称')
  })

  test('首次扫码时 accounts.json 不存在也会自动创建', () => {
    const workDir = makeWorkDir()
    const accountsPath = path.join(workDir, 'data', 'accounts.json')
    const registry = { sessions: [], byAccessKey: new Map() }

    createAccountWithCookie(
      'first-key',
      'qq',
      'uin=o123; qm_keyst=secret',
      registry,
      workDir,
      '首次扫码账号'
    )

    expect(fs.existsSync(accountsPath)).toBe(true)
    expect(JSON.parse(fs.readFileSync(accountsPath, 'utf8'))).toEqual([
      expect.objectContaining({
        platform: 'qq',
        name: '首次扫码账号',
        api_access_key: 'first-key',
        lxSource: []
      })
    ])
    expect(registry.byAccessKey.get('first-key').name).toBe('首次扫码账号')
  })

  test('忽略 stateless 非 boolean 的账号', () => {
    const workDir = makeWorkDir()
    fs.writeFileSync(path.join(workDir, 'data', 'accounts.json'), JSON.stringify([
      { platform: 'qq', name: 'invalid', cookie: 'cookie', api_access_key: 'key-1', stateless: 'false' }
    ]))

    const registry = loadAccountSessions(workDir)

    expect(registry.sessions).toHaveLength(0)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('stateless 必须是 boolean'))
  })
})
