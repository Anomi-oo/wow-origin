const express = require('express')
const fs = require('fs')
const os = require('os')
const path = require('path')
const request = require('supertest')
const { loadAccountSessions } = require('../../../dist/accounts')
const { createLocalAccountStore } = require('../../../dist/storage')
const { createLoginRouter } = require('../../../dist/login')
const { APIError } = require('../../../dist/errors')

function makeWorkDir() {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'music-api-login-'))
  fs.mkdirSync(path.join(workDir, 'data'), { recursive: true })
  fs.writeFileSync(path.join(workDir, 'data', 'accounts.json'), JSON.stringify([
    { platform: 'qq', name: 'QQ', cookie: 'old_cookie', api_access_key: 'key-1' }
  ]))
  return workDir
}

function createApp(workDir, factory) {
  const app = express()
  const accountStore = createLocalAccountStore(workDir)
  const registry = loadAccountSessions(accountStore)
  app.use(express.json())
  app.use('/login', createLoginRouter({ registry, platformFactory: factory, accountStore }))
  app.use((error, _req, res, _next) => {
    const status = error instanceof APIError ? error.status : 500
    res.status(status).json({ code: status, message: error.message, data: null })
  })
  return { app, registry, accountStore }
}

function readAccounts(workDir) {
  const store = createLocalAccountStore(workDir)
  try { return store.list() } finally { store.close() }
}

describe('login router', () => {
  let logSpy

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
  })

  test.each([
    ['qq', 'qqmusic', 'Cookie: qqmusic_uin=123; qqmusic_key=secret', 'login/cookie', { nickname: 'QQ 用户' }],
    ['netease', 'netease', 'MUSIC_U=secret', 'user/detail', { nickname: '网易用户', userId: 456 }]
  ])('%s Cookie 校验成功后持久化且不返回 Cookie', async (platform, resource, cookie, route, profile) => {
    const workDir = makeWorkDir()
    const callModule = jest.fn(async () => ({ code: 200, body: profile }))
    const factory = { getPlatform: jest.fn(() => ({ callModule })) }
    const { app, registry } = createApp(workDir, factory)
    const response = await request(app).post('/login/api/cookie').send({ mode: 'create', platform, cookie }).expect(200)
    expect(factory.getPlatform).toHaveBeenCalledWith(resource)
    expect(callModule).toHaveBeenCalledWith(route, expect.any(Object))
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.body.data).toMatchObject({ status: 'success', accountName: profile.nickname, platform })
    expect(JSON.stringify(response.body)).not.toContain('secret')
    const saved = registry.byAccessKey.get(response.body.data.apiAccessKey)
    expect(saved.cookie).toContain(platform === 'qq' ? 'qm_keyst=secret' : 'MUSIC_U=secret')
    expect(readAccounts(workDir)).toHaveLength(2)
  })

  test('Cookie 更新保留原来的 key、名称和账号配置', async () => {
    const workDir = makeWorkDir()
    const { app, registry } = createApp(workDir, { getPlatform: () => ({ callModule: async () => ({ code: 200, body: { nickname: '新昵称' } }) }) })
    await request(app).post('/login/api/cookie').send({ mode: 'update', api_access_key: 'key-1', cookie: 'uin=123; qm_keyst=new' }).expect(200)
    expect(registry.byAccessKey.get('key-1')).toMatchObject({ name: 'QQ', cookie: 'uin=123; qm_keyst=new', stateless: true })
    expect(readAccounts(workDir)).toHaveLength(1)
  })

  test.each(['', 'uin=123', 'uin=123; qm_keyst=x\r\nother: header'])('拒绝无效 Cookie 且不调用上游', async cookie => {
    const workDir = makeWorkDir()
    const callModule = jest.fn()
    const { app } = createApp(workDir, { getPlatform: () => ({ callModule }) })
    await request(app).post('/login/api/cookie').send({ mode: 'create', platform: 'qq', cookie }).expect(400)
    expect(callModule).not.toHaveBeenCalled()
    expect(readAccounts(workDir)).toHaveLength(1)
  })

  test('过期 Cookie 不覆盖已有凭证', async () => {
    const workDir = makeWorkDir()
    const { app, registry } = createApp(workDir, { getPlatform: () => ({ callModule: async () => ({ code: 500, message: 'Cookie 已过期' }) }) })
    await request(app).post('/login/api/cookie').send({ mode: 'update', api_access_key: 'key-1', cookie: 'uin=123; qm_keyst=expired' }).expect(502)
    expect(registry.byAccessKey.get('key-1').cookie).toBe('old_cookie')
  })

  test('网易 Cookie 无用户身份时不创建账号', async () => {
    const workDir = makeWorkDir()
    const { app } = createApp(workDir, { getPlatform: () => ({ callModule: async () => ({ code: 200, body: {} }) }) })
    await request(app).post('/login/api/cookie').send({ mode: 'create', platform: 'netease', cookie: 'MUSIC_U=expired' }).expect(400)
    expect(readAccounts(workDir)).toHaveLength(1)
  })

  test.each(['qq', 'netease'])('%s 手机登录校验成功后保存账号，token 不能复用', async (platform) => {
    const workDir = makeWorkDir()
    const callModule = jest.fn(async route => {
      if (route === 'login/phone/send') return { code: 200, body: { status: 'sent', token: 'phone-token', retryAfter: 60 } }
      if (route === 'login/phone/check') return { code: 200, cookie: platform === 'qq' ? { uin: '123', qm_keyst: 'phone-secret', loginType: '0' } : { MUSIC_U: 'netease-secret' } }
      return { code: 200, nickname: '手机用户' }
    })
    const factory = { getPlatform: jest.fn(() => ({ callModule })) }
    const { app } = createApp(workDir, factory)
    await request(app).post('/login/api/phone/send').send({ mode: 'create', platform, phone: '13800000000' }).expect(200)
    const response = await request(app).post('/login/api/phone/check').send({ token: 'phone-token', code: '123456' }).expect(200)
    expect(response.body.data).toMatchObject({ status: 'success', accountName: '手机用户', platform })
    expect(factory.getPlatform.mock.calls.every(([name]) => name === (platform === 'qq' ? 'qqmusic' : 'netease'))).toBe(true)
    expect(readAccounts(workDir)).toHaveLength(2)
    await request(app).post('/login/api/phone/check').send({ token: 'phone-token', code: '123456' }).expect(400)
  })

  test('手机会话不能在重发时切换平台，校验也不能指定其他平台', async () => {
    const workDir = makeWorkDir()
    const callModule = jest.fn(async () => ({ code: 200, body: { status: 'sent', token: 'phone-token' } }))
    const { app } = createApp(workDir, { getPlatform: () => ({ callModule }) })
    await request(app).post('/login/api/phone/send').send({ mode: 'create', platform: 'qq', phone: '13800000000' }).expect(200)
    await request(app).post('/login/api/phone/send').send({ mode: 'create', platform: 'netease', phone: '13800000000', token: 'phone-token' }).expect(400)
    await request(app).post('/login/api/phone/check').send({ platform: 'netease', token: 'phone-token', code: '123456' }).expect(400)
    expect(callModule).toHaveBeenCalledTimes(1)
  })

  test('QQ 安全验证使用受限代理页，避免官方脚本在 iframe 中跳转顶层页面', async () => {
    const workDir = makeWorkDir()
    const securityUrl = 'https://c.y.qq.com/r/fy6U?tokenValid=opaque-upstream-token&appid=50910'
    const callModule = jest.fn(async () => ({ code: 200, body: {
      status: 'captcha', token: 'phone-token', securityUrl, retryAfter: 0
    } }))
    const { app } = createApp(workDir, { getPlatform: () => ({ callModule }) })
    const send = await request(app).post('/login/api/phone/send')
      .send({ mode: 'create', platform: 'qq', phone: '13800000000' }).expect(200)
    expect(send.body.data).toMatchObject({
      status: 'captcha', token: 'phone-token', securityPath: '/login/api/phone/captcha?token=phone-token'
    })
    expect(send.body.data).not.toHaveProperty('securityUrl')

    const musicUrl = 'https://y.qq.com/lib/commercial/h5/music-2.3.0.min.js?version=20210918&max_age=604800'
    const remoteHtml = `<!doctype html><html><head><script src="${musicUrl}"></script></head><body><script>new SafetyCaptcha({ verifyUrl: window.location.href });</script></body></html>`
    const musicScript = 'window===window.top||window.allowIframe||(top.location=self.location),/http:|https:/.test(location.protocol)&&!/qq\\.com/.test(location.hostname)&&(location.href=location.protocol+"//m.y.qq.com/?ADTAG=hostname_err"),window.MusicReady=true;'
    const fetchSpy = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        ok: true, url: 'https://y.qq.com/m/client/safety_captcha/index.html', headers: new Headers(),
        text: async () => remoteHtml,
      })
      .mockResolvedValueOnce({
        ok: true, url: musicUrl, headers: new Headers(),
        text: async () => musicScript,
      })
    const frame = await request(app).get(send.body.data.securityPath).expect(200)
    expect(fetchSpy).toHaveBeenCalledWith(securityUrl, expect.objectContaining({ redirect: 'follow' }))
    expect(frame.headers['content-type']).toContain('text/html')
    expect(frame.headers['content-security-policy']).toContain("script-src https: 'unsafe-inline' 'unsafe-eval' blob:")
    expect(fetchSpy).toHaveBeenCalledWith(musicUrl, expect.objectContaining({ redirect: 'follow' }))
    expect(frame.text.indexOf('window.allowIframe=true')).toBeLessThan(frame.text.indexOf('window.MusicReady=true'))
    expect(frame.text).not.toContain('src="https://y.qq.com/lib/commercial/h5/music-2.3.0.min.js')
    expect(frame.text).not.toContain('ADTAG=hostname_err')
    expect(frame.text).toContain(`verifyUrl: ${JSON.stringify(securityUrl)}`)
    expect(frame.text).not.toContain('verifyUrl: window.location.href')
    fetchSpy.mockRestore()
  })

  test('安全验证代理拒绝非 QQ 地址和未知会话', async () => {
    const workDir = makeWorkDir()
    const callModule = jest.fn(async () => ({ code: 200, body: {
      status: 'captcha', token: 'phone-token', securityUrl: 'https://example.com/verify', retryAfter: 0
    } }))
    const { app } = createApp(workDir, { getPlatform: () => ({ callModule }) })
    await request(app).post('/login/api/phone/send')
      .send({ mode: 'create', platform: 'qq', phone: '13800000000' }).expect(502)
    await request(app).get('/login/api/phone/captcha?token=missing').expect(400)
  })

  test('更新账号的手机 token 必须绑定原账号，不能变成新建会话', async () => {
    const workDir = makeWorkDir()
    const callModule = jest.fn(async () => ({ code: 200, body: { status: 'sent', token: 'phone-token' } }))
    const { app } = createApp(workDir, { getPlatform: () => ({ callModule }) })
    await request(app).post('/login/api/phone/send').send({ mode: 'update', api_access_key: 'key-1', phone: '13800000000' }).expect(200)
    await request(app).post('/login/api/phone/check').send({ token: 'phone-token', code: '123456' }).expect(400)
    await request(app).post('/login/api/phone/send').send({ mode: 'create', platform: 'qq', token: 'phone-token', phone: '13800000000' }).expect(400)
    expect(callModule).toHaveBeenCalledTimes(1)
  })

  test('GET /login 返回登录页面', async () => {
    const workDir = makeWorkDir()
    const { app } = createApp(workDir, {
      getPlatform: () => ({ callModule: jest.fn() })
    })

    const response = await request(app)
      .get('/login?api_access_key=key-1')
      .expect(200)

    expect(response.text).toContain('扫码登录')
    expect(response.text).toContain('添加新账号')
    expect(response.text).not.toContain('<button data-method="phone"')
    expect(response.text).toContain('Cookie 登录')
    expect(response.text).toContain('id="login-methods" class="login-methods"')
    expect(response.text).not.toContain('class="segment login-methods"')
    expect(response.text.indexOf('id="login-methods"')).toBeGreaterThan(response.text.indexOf('id="qr-login-panel"'))
    expect(response.text).toContain('更新已存在账号')
    expect(response.text).toContain('id="account-config" class="login-step hidden"')
    expect(response.text).toContain('id="account-origin-qr"')
    expect(response.text).toContain('id="account-name"')
    expect(response.text).toContain('id="account-stateless"')
    expect(response.text).toContain('id="account-luoxue"')
    expect(response.text).toContain('id="add-lx-source"')
    expect(response.text).toContain('id="save-config"')
    expect(response.text).not.toContain('网页不提供无登录账号的创建入口')
  })

  test('验证已存在账号 key', async () => {
    const workDir = makeWorkDir()
    const { app } = createApp(workDir, {
      getPlatform: () => ({ callModule: jest.fn() })
    })

    const response = await request(app)
      .post('/login/api/verify-key')
      .send({ api_access_key: 'key-1' })
      .expect(200)

    expect(response.body.data).toMatchObject({
      apiAccessKey: 'key-1',
      platform: 'qq',
      accountName: 'QQ',
      stateless: true,
      useLuoxue: true,
      lxSource: []
    })
  })

  test('Web 使用无效 key 时不能进入账号详情', async () => {
    const workDir = makeWorkDir()
    const { app } = createApp(workDir, {
      getPlatform: () => ({ callModule: jest.fn() })
    })

    const response = await request(app)
      .post('/login/api/verify-key')
      .send({ api_access_key: 'missing' })
      .expect(400)

    expect(response.body.message).toContain('无效')
  })

  test('QQ 扫码成功后写回 accounts.json 和 registry', async () => {
    const workDir = makeWorkDir()
    const callModule = jest.fn(async (route) => {
      if (route === 'login/qr/key') {
        return {
          code: 200,
          body: {
            data: {
              unikey: 'qr-token',
              qrImg: 'data:image/png;base64,abc'
            }
          }
        }
      }
      if (route === 'user/detail') {
        return {
          code: 200,
          body: {
            userId: 123,
            nickname: '扫码昵称',
            avatarUrl: 'https://example.com/avatar.png',
            vipType: 0
          }
        }
      }
      return {
        code: 200,
        body: {
          code: 803,
          message: '授权登录成功'
        },
        cookie: {
          uin: 'o123',
          qm_keyst: 'secret'
        }
      }
    })
    const { app, registry } = createApp(workDir, {
      getPlatform: () => ({ callModule })
    })

    const start = await request(app)
      .post('/login/api/start')
      .send({ mode: 'update', api_access_key: 'key-1', platform: 'qq' })
      .expect(200)

    expect(start.body.data).toMatchObject({
      mode: 'update',
      platform: 'qq',
      apiAccessKey: 'key-1',
      token: 'qr-token',
      qrImage: 'data:image/png;base64,abc'
    })

    const check = await request(app)
      .post('/login/api/check')
      .send({ token: 'qr-token' })
      .expect(200)

    const saved = readAccounts(workDir)
    expect(check.body.data).toMatchObject({
      status: 'success',
      mode: 'update',
      apiAccessKey: 'key-1',
      message: '登录成功'
    })
    expect(saved[0]).toMatchObject({
      platform: 'qq',
      name: 'QQ',
      cookie: 'uin=o123; qm_keyst=secret',
      api_access_key: 'key-1'
    })
    expect(registry.byAccessKey.get('key-1').cookie).toBe('uin=o123; qm_keyst=secret')
    expect(registry.byAccessKey.get('key-1').name).toBe('QQ')
  })

  test('用户详情无昵称时仍写回 cookie 并保留原账号名', async () => {
    const workDir = makeWorkDir()
    const callModule = jest.fn(async (route) => {
      if (route === 'login/qr/key') {
        return {
          code: 200,
          body: {
            data: {
              unikey: 'qr-token',
              qrImg: 'data:image/png;base64,abc'
            }
          }
        }
      }
      if (route === 'user/detail') {
        return {
          code: 200,
          body: {
            userId: 123
          }
        }
      }
      return {
        code: 200,
        body: {
          code: 803,
          message: '授权登录成功'
        },
        cookie: {
          uin: 'o123',
          qm_keyst: 'secret'
        }
      }
    })
    const { app, registry } = createApp(workDir, {
      getPlatform: () => ({ callModule })
    })

    await request(app)
      .post('/login/api/start')
      .send({ mode: 'update', api_access_key: 'key-1', platform: 'qq' })
      .expect(200)

    await request(app)
      .post('/login/api/check')
      .send({ token: 'qr-token' })
      .expect(200)

    const saved = readAccounts(workDir)
    expect(saved[0]).toMatchObject({
      platform: 'qq',
      name: 'QQ',
      cookie: 'uin=o123; qm_keyst=secret',
      api_access_key: 'key-1'
    })
    expect(registry.byAccessKey.get('key-1').name).toBe('QQ')
    expect(registry.byAccessKey.get('key-1').cookie).toBe('uin=o123; qm_keyst=secret')
  })

  test('更新模式缺少 api_access_key 返回 400', async () => {
    const workDir = makeWorkDir()
    const { app } = createApp(workDir, {
      getPlatform: () => ({ callModule: jest.fn() })
    })

    const response = await request(app)
      .post('/login/api/start')
      .send({ mode: 'update', platform: 'qq' })
      .expect(400)

    expect(response.body.message).toContain('api_access_key')
  })

  test('更新模式 key 不存在时拒绝生成二维码', async () => {
    const workDir = makeWorkDir()
    const callModule = jest.fn()
    const { app } = createApp(workDir, {
      getPlatform: () => ({ callModule })
    })

    const response = await request(app)
      .post('/login/api/start')
      .send({ mode: 'update', api_access_key: 'missing', platform: 'qq' })
      .expect(400)

    expect(response.body.message).toContain('无效')
    expect(callModule).not.toHaveBeenCalled()
  })

  test('更新模式不能切换已有账号平台', async () => {
    const workDir = makeWorkDir()
    const callModule = jest.fn()
    const { app } = createApp(workDir, { getPlatform: () => ({ callModule }) })

    const response = await request(app)
      .post('/login/api/start')
      .send({ mode: 'update', api_access_key: 'key-1', platform: 'netease' })
      .expect(400)

    expect(response.body.message).toContain('不能修改平台')
    expect(callModule).not.toHaveBeenCalled()
  })

  test('已有账号配置可独立保存且不修改 cookie 和平台', async () => {
    const workDir = makeWorkDir()
    const { app, registry } = createApp(workDir, { getPlatform: () => ({ callModule: jest.fn() }) })

    const response = await request(app)
      .put('/login/api/account/config')
      .send({
        api_access_key: 'key-1',
        name: '客厅账号',
        stateless: true,
        useLuoxue: true,
        lxSource: [' https://example.com/a.js ', 'https://example.com/a.js']
      })
      .expect(200)

    expect(response.body.data).toMatchObject({
      platform: 'qq',
      name: '客厅账号',
      stateless: true,
      useLuoxue: true,
      lxSource: ['https://example.com/a.js']
    })
    expect(registry.byAccessKey.get('key-1').cookie).toBe('old_cookie')
    const saved = readAccounts(workDir)
    expect(saved[0]).toMatchObject({ platform: 'qq', cookie: 'old_cookie', name: '客厅账号' })
  })

  test('新增账号扫码成功后追加写回 accounts.json 和 registry', async () => {
    const workDir = makeWorkDir()
    const callModule = jest.fn(async (route) => {
      if (route === 'login/qr/key') {
        return {
          code: 200,
          body: {
            data: {
              unikey: 'new-qr-token',
              qrImg: 'data:image/png;base64,new'
            }
          }
        }
      }
      if (route === 'user/detail') {
        return {
          code: 200,
          body: {
            userId: 123,
            nickname: '新增昵称'
          }
        }
      }
      return {
        code: 200,
        body: {
          code: 803,
          message: '授权登录成功'
        },
        cookie: {
          uin: 'o999',
          qm_keyst: 'new_secret'
        }
      }
    })
    const { app, registry } = createApp(workDir, {
      getPlatform: () => ({ callModule })
    })

    const start = await request(app)
      .post('/login/api/start')
      .send({ mode: 'create', platform: 'qq' })
      .expect(200)

    expect(start.body.data).toMatchObject({
      mode: 'create',
      platform: 'qq',
      token: 'new-qr-token'
    })
    expect(start.body.data.apiAccessKey).toMatch(/^[0-9a-f]{32}$/)
    expect(start.body.data.apiAccessKey).not.toContain('-')

    const check = await request(app)
      .post('/login/api/check')
      .send({ token: 'new-qr-token' })
      .expect(200)

    const saved = readAccounts(workDir)
    expect(check.body.data).toMatchObject({
      status: 'success',
      mode: 'create',
      apiAccessKey: start.body.data.apiAccessKey,
      accountName: '新增昵称'
    })
    expect(saved).toHaveLength(2)
    expect(saved[1]).toMatchObject({
      platform: 'qq',
      name: '新增昵称',
      cookie: 'uin=o999; qm_keyst=new_secret',
      api_access_key: start.body.data.apiAccessKey,
      lxSource: []
    })
    expect(registry.byAccessKey.get(start.body.data.apiAccessKey).name).toBe('新增昵称')
  })
})
