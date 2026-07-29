const express = require('express')
const fs = require('fs')
const os = require('os')
const path = require('path')
const request = require('supertest')
const { loadAccountSessions } = require('../../../dist/accounts')
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
  const registry = loadAccountSessions(workDir)
  app.use(express.json())
  app.use('/login', createLoginRouter({ registry, platformFactory: factory, workDir }))
  app.use((error, _req, res, _next) => {
    const status = error instanceof APIError ? error.status : 500
    res.status(status).json({ code: status, message: error.message, data: null })
  })
  return { app, registry }
}

describe('login router', () => {
  let logSpy

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
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
    expect(response.text).toContain('以新账号添加')
    expect(response.text).toContain('更新已存在账号')
    expect(response.text).toContain('/login/api/start')
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
      accountName: 'QQ'
    })
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

    const saved = JSON.parse(fs.readFileSync(path.join(workDir, 'data', 'accounts.json'), 'utf8'))
    expect(check.body.data).toMatchObject({
      status: 'success',
      mode: 'update',
      apiAccessKey: 'key-1',
      message: '登录成功'
    })
    expect(saved[0]).toMatchObject({
      platform: 'qq',
      name: '扫码昵称',
      cookie: 'uin=o123; qm_keyst=secret',
      api_access_key: 'key-1'
    })
    expect(registry.byAccessKey.get('key-1').cookie).toBe('uin=o123; qm_keyst=secret')
    expect(registry.byAccessKey.get('key-1').name).toBe('扫码昵称')
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

    const saved = JSON.parse(fs.readFileSync(path.join(workDir, 'data', 'accounts.json'), 'utf8'))
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

    const saved = JSON.parse(fs.readFileSync(path.join(workDir, 'data', 'accounts.json'), 'utf8'))
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
      api_access_key: start.body.data.apiAccessKey
    })
    expect(registry.byAccessKey.get(start.body.data.apiAccessKey).name).toBe('新增昵称')
  })
})
