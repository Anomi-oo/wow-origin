const express = require('express')
const request = require('supertest')
const { createDashboardRouter } = require('../../../dist/dashboard')
const { createLoginRouter } = require('../../../dist/login')
const { loadAccountSessions } = require('../../../dist/accounts')

function setup(password = '') {
  let rows = [{ platform: 'netease', name: '账号', api_access_key: 'own-key', cookie: 'MUSIC_U=secret' }]
  const store = { location: 'memory', list: () => rows, delete: jest.fn(key => { rows = rows.filter(row => row.api_access_key !== key) }) }
  const registry = loadAccountSessions(store)
  const changed = jest.fn()
  const app = express().use(express.json()).use('/app/api', createDashboardRouter({ registry, accountStore: store, adminManagementPassword: password, onAccountsChanged: changed }))
  app.use('/login', createLoginRouter({ registry, accountStore: store, platformFactory: { getPlatform() { throw new Error('unexpected platform request') } } }))
  return { app, store, registry, changed }
}

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
