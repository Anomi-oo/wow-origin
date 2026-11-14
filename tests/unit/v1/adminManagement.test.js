// 业务测试验证日志内容；级别、时间和上下文格式由 Logger 单元测试覆盖。
jest.mock('../../../core/Logger', () => {
  const Logger = jest.requireActual('../../../core/Logger')
  Logger.createConsole = () => console
  return Logger
})

const express = require('express')
const request = require('supertest')
const { createDashboardRouter } = require('../../../dist/dashboard')
const { createLoginRouter } = require('../../../dist/login')
const { loadAccountSessions } = require('../../../dist/accounts')

function setup(password = '', platform = 'netease') {
  let rows = [{ platform, name: '账号', api_access_key: 'own-key', cookie: platform === 'qq' ? 'uin=123; qm_keyst=secret; loginType=1' : 'MUSIC_U=secret' }]
  const store = { location: 'memory', list: () => rows, delete: jest.fn(key => { rows = rows.filter(row => row.api_access_key !== key) }) }
  const registry = loadAccountSessions(store)
  const changed = jest.fn()
  const app = express().use(express.json()).use('/app/api', createDashboardRouter({ registry, accountStore: store, adminManagementPassword: password, onAccountsChanged: changed }))
  app.use('/login', createLoginRouter({ registry, accountStore: store, platformFactory: { getPlatform() { throw new Error('unexpected platform request') } } }))
  return { app, store, registry, changed }
}

beforeEach(() => {
  jest.spyOn(require('../../../platforms/PlatformFactory'), 'getPlatform').mockReturnValue({
    callModule: jest.fn(async () => ({ code: 200, body: { code: 200 } }))
  })
})

afterEach(() => { delete process.env.WOW_DESKTOP })

test.each(['', '   '])('unconfigured admin is hidden and account list denied (%j)', async password => {
  const { app } = setup(password)
  expect((await request(app).get('/app/api/status')).body.data.adminManagementEnabled).toBe(false)
  await request(app).get('/app/api/accounts').expect(404)
})

test('admin list requires correct admin password, not an account key', async () => {
  const { app } = setup('admin-secret')
  const status = await request(app).get('/app/api/status')
  expect(status.body.data.adminManagementEnabled).toBe(true)
  expect(JSON.stringify(status.body)).not.toContain('admin-secret')
  for (const key of ['', 'bad', 'own-key']) await request(app).get('/app/api/accounts').set('Authorization', `Bearer ${key}`).expect(401)
  const result = await request(app).get('/app/api/accounts').set('Authorization', 'Bearer admin-secret').expect(200)
  expect(result.body.data).toEqual([{ platform: 'netease', name: '账号', apiAccessKey: 'own-key' }])
  expect(result.headers['cache-control']).toBe('no-store')
})

test('desktop is an admin without a password', async () => {
  process.env.WOW_DESKTOP = '1'
  await request(setup().app).get('/app/api/accounts').expect(200)
})

test('account key owner deletes database and live state without admin credentials', async () => {
  const { app, store, registry, changed } = setup('admin-secret')
  const session = registry.byAccessKey.get('own-key')
  session.favoriteTrackIds.add('old-track')
  const cleanup = jest.fn()
  registry.onDeleted = new Set([cleanup])
  await request(app).post('/app/api/accounts/delete').send({}).expect(400)
  await request(app).post('/app/api/accounts/delete').send({ api_access_key: 'wrong' }).expect(404)
  expect(store.delete).not.toHaveBeenCalled()
  await request(app).post('/app/api/accounts/delete').send({ api_access_key: 'own-key' }).expect(200)
  await request(app).post('/login/api/verify-key').send({ api_access_key: 'own-key' }).expect(400)
  expect(store.list()).toEqual([])
  expect(registry.sessions).toEqual([])
  expect(registry.byAccessKey.has('own-key')).toBe(false)
  expect(session.cookie).toBe('')
  expect(session.favoriteTrackIds.size).toBe(0)
  session.favoriteTrackIds.add('late-response')
  expect(session.favoriteTrackIds.size).toBe(0)
  expect(cleanup).toHaveBeenCalledWith(session)
  expect(changed).toHaveBeenCalledTimes(1)
  await request(app).post('/app/api/accounts/delete').send({ api_access_key: 'own-key' }).expect(404)
})

test('database failure leaves the live account intact', async () => {
  const { app, store, registry } = setup()
  store.delete.mockImplementation(() => { throw new Error('database unavailable') })
  await request(app).post('/app/api/accounts/delete').send({ api_access_key: 'own-key' }).expect(500)
  expect(registry.byAccessKey.has('own-key')).toBe(true)
  expect(registry.sessions).toHaveLength(1)
})

test.each(['qq', 'netease'])('%s deletion waits for logout with current credentials before deleting', async platform => {
  let finishLogout, notifyStarted
  const started = new Promise(resolve => { notifyStarted = resolve })
  const callModule = jest.fn(() => {
    notifyStarted()
    return new Promise(resolve => { finishLogout = resolve })
  })
  const factory = require('../../../platforms/PlatformFactory')
  jest.spyOn(factory, 'getPlatform').mockReturnValue({ callModule })
  const { app, store, registry, changed } = setup('', platform)
  const session = registry.byAccessKey.get('own-key')
  session.deviceState = 'stored-device'
  const deleting = request(app).post('/app/api/accounts/delete').send({ api_access_key: 'own-key' }).then(response => response)
  await started
  expect(store.delete).not.toHaveBeenCalled()
  expect(registry.byAccessKey.has('own-key')).toBe(true)
  expect(factory.getPlatform).toHaveBeenCalledWith(platform === 'qq' ? 'qqmusic' : 'netease')
  expect(callModule).toHaveBeenCalledWith('login/logout', expect.objectContaining({ query: expect.objectContaining({
    ...(platform === 'qq' ? { uin: '123', qm_keyst: 'secret', loginType: '1', qq_android_identity: 'stored-device', platform: 'qqmusic' } : { MUSIC_U: 'secret', platform: 'netease' })
  }) }))
  finishLogout({ code: 200, body: { code: 200 } })
  expect((await deleting).status).toBe(200)
  expect(store.delete).toHaveBeenCalledWith('own-key')
  expect(changed).toHaveBeenCalledTimes(1)
  expect(registry.byAccessKey.has('own-key')).toBe(false)
})

test.each([['qq', 'upstream error'], ['qq', 'timeout'], ['netease', 'upstream error'], ['netease', 'timeout'], ['qq', 'invalid response'], ['netease', 'invalid response']])('%s logout %s is logged and local account is still deleted', async (platform, failure) => {
  const callModule = jest.fn(async () => {
    if (failure === 'timeout') throw Object.assign(new Error('sensitive-cookie'), { code: 'UPSTREAM_TIMEOUT' })
    return failure === 'invalid response' ? { code: 200, body: 'invalid' } : { code: 500, message: 'sensitive-cookie' }
  })
  jest.spyOn(require('../../../platforms/PlatformFactory'), 'getPlatform').mockReturnValue({ callModule })
  const warning = jest.spyOn(console, 'warn').mockImplementation(() => {})
  const { app, store, registry } = setup('', platform)
  await request(app).post('/app/api/accounts/delete').send({ api_access_key: 'own-key' }).expect(200)
  expect(store.delete).toHaveBeenCalledWith('own-key')
  expect(registry.byAccessKey.has('own-key')).toBe(false)
  expect(warning).toHaveBeenCalledWith(expect.stringContaining('继续删除账号'), expect.any(Object))
  expect(JSON.stringify(warning.mock.calls)).not.toContain('sensitive-cookie')
})

test('concurrent deletions wait for logout and clean up the account once', async () => {
  const finishes = []
  let notifyStarted
  const started = new Promise(resolve => { notifyStarted = resolve })
  const callModule = jest.fn(() => new Promise(resolve => {
    finishes.push(resolve)
    if (finishes.length === 2) notifyStarted()
  }))
  jest.spyOn(require('../../../platforms/PlatformFactory'), 'getPlatform').mockReturnValue({ callModule })
  const { app, store, changed } = setup('', 'qq')
  const deletions = [1, 2].map(() => request(app).post('/app/api/accounts/delete').send({ api_access_key: 'own-key' }).then(response => response))
  await started
  expect(store.delete).not.toHaveBeenCalled()
  finishes.forEach(resolve => resolve({ code: 200, body: { code: 200 } }))
  expect((await Promise.all(deletions)).map(response => response.status)).toEqual([200, 200])
  expect(store.delete).toHaveBeenCalledTimes(1)
  expect(changed).toHaveBeenCalledTimes(1)
})
