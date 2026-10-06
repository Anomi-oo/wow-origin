const {
  refreshLoginSessions, ensureQQLoginFresh, qqNextLoginCheckAt, createLoginRefreshScheduler
} = require('../../../src/loginRefresh.ts')

test('QQ 刷新凭证会合并并持久化新的 Cookie', async () => {
  const { session, registry, store, logger } = fixture('key-1', 'uin=123; qm_keyst=old; refresh_token=keep')
  const callModule = jest.fn(async () => ({
    code: 200, refreshed: true,
    cookie: { uin: '123', qm_keyst: 'new', refresh_key: 'new-refresh-key' },
  }))
  const summary = await refreshLoginSessions({
    registry, accountStore: store, logger,
    platformFactory: { getPlatform: () => ({ callModule }) },
  })

  expect(summary).toEqual({ total: 1, refreshed: 1, unchanged: 0, failed: 0 })
  expect(callModule).toHaveBeenCalledWith('login/refresh', expect.objectContaining({
    query: expect.objectContaining({ uin: '123', qm_keyst: 'old', refresh_token: 'keep' }),
  }))
  expect(session.cookie).toContain('qm_keyst=new')
  expect(session.cookie).toContain('refresh_token=keep')
  expect(session.cookie).toContain('refresh_key=new-refresh-key')
  expect(store.update).toHaveBeenCalledWith('key-1', { cookie: session.cookie })
})

function fixture(key, cookie = 'uin=123; qm_keyst=old; refresh_key=refresh') {
  const account = { platform: 'qq', name: 'QQ', api_access_key: key, cookie }
  const session = {
    platform: 'qq', name: 'QQ', apiAccessKey: key, cookie,
    stateless: true, useLuoxue: true, lxSource: [], favoriteTrackIds: new Set(),
  }
  const registry = { sessions: [session], byAccessKey: new Map([[key, session]]) }
  const store = {
    location: 'memory', list: () => [account], insert: jest.fn(),
    update: jest.fn((_key, changes) => Object.assign(account, changes)),
  }
  const logger = { info: jest.fn(), error: jest.fn(), warn: jest.fn() }
  return { account, session, registry, store, logger }
}

test('QQ 凭证有效时每小时仅检查一次，超过时间后重新检查', async () => {
  const { session, registry, store, logger } = fixture('qq-hourly')
  let now = 1_000_000
  const clock = jest.spyOn(Date, 'now').mockImplementation(() => now)
  const callModule = jest.fn(async () => ({ code: 200, expired: false }))
  const options = { registry, accountStore: store, logger, platformFactory: { getPlatform: () => ({ callModule }) } }
  try {
    await ensureQQLoginFresh(session, options)
    expect(qqNextLoginCheckAt.get(session.apiAccessKey)).toBe(now + 60 * 60 * 1000)
    now += 60 * 60 * 1000 - 1
    await ensureQQLoginFresh(session, options)
    expect(callModule).toHaveBeenCalledTimes(1)
    now += 1
    await ensureQQLoginFresh(session, options)
    expect(callModule).toHaveBeenCalledTimes(2)
    expect(callModule).toHaveBeenCalledWith('login/check/expired', expect.anything())
  } finally {
    clock.mockRestore()
  }
})

test('QQ 凭证过期时只刷新一次，并让并发请求共用检查结果', async () => {
  const { session, registry, store, logger } = fixture('qq-concurrent')
  let resolveCheck
  const callModule = jest.fn((route) => route === 'login/check/expired'
    ? new Promise((resolve) => { resolveCheck = resolve })
    : Promise.resolve({ code: 200, refreshed: true, cookie: { qm_keyst: 'new' } }))
  const options = { registry, accountStore: store, logger, platformFactory: { getPlatform: () => ({ callModule }) } }
  const first = ensureQQLoginFresh(session, options)
  const second = ensureQQLoginFresh(session, options)
  resolveCheck({ code: 200, expired: true })
  await Promise.all([first, second])
  expect(callModule.mock.calls.map(([route]) => route)).toEqual(['login/check/expired', 'login/refresh'])
  expect(session.cookie).toContain('qm_keyst=new')
  expect(store.update).toHaveBeenCalledTimes(1)
  await ensureQQLoginFresh(session, options)
  expect(callModule).toHaveBeenCalledTimes(2)
})

test('QQ 检查失败时保留旧凭证，一分钟后重试', async () => {
  const { session, registry, store, logger } = fixture('qq-retry')
  let now = 5_000_000
  const clock = jest.spyOn(Date, 'now').mockImplementation(() => now)
  const callModule = jest.fn()
    .mockResolvedValueOnce({ code: 500, message: '上游暂时不可用' })
    .mockResolvedValueOnce({ code: 200, expired: false })
  const options = { registry, accountStore: store, logger, platformFactory: { getPlatform: () => ({ callModule }) } }
  try {
    await expect(ensureQQLoginFresh(session, options)).rejects.toThrow('上游暂时不可用')
    expect(session.cookie).toContain('qm_keyst=old')
    expect(qqNextLoginCheckAt.get(session.apiAccessKey)).toBe(now + 60 * 1000)
    await ensureQQLoginFresh(session, options)
    expect(callModule).toHaveBeenCalledTimes(1)
    now += 60 * 1000
    await ensureQQLoginFresh(session, options)
    expect(callModule).toHaveBeenCalledTimes(2)
  } finally {
    clock.mockRestore()
  }
})

test('凌晨任务仅刷新网易账号', async () => {
  const qq = fixture('qq-daily')
  const netease = { ...qq.session, platform: 'netease', name: '网易', apiAccessKey: 'netease-daily', cookie: 'MUSIC_U=old' }
  qq.registry.sessions.push(netease)
  qq.registry.byAccessKey.set(netease.apiAccessKey, netease)
  const account = { platform: 'netease', name: '网易', api_access_key: 'netease-daily', cookie: netease.cookie }
  qq.store.list = () => [qq.account, account]
  const callModule = jest.fn(async () => ({ code: 200, refreshed: false }))
  const scheduler = createLoginRefreshScheduler({
    registry: qq.registry, accountStore: qq.store, logger: qq.logger,
    platformFactory: { getPlatform: () => ({ callModule }) },
  })
  expect(await scheduler.runNow()).toEqual({ total: 1, refreshed: 0, unchanged: 1, failed: 0 })
  expect(callModule).toHaveBeenCalledTimes(1)
  expect(callModule).toHaveBeenCalledWith('login/refresh', expect.objectContaining({
    query: expect.objectContaining({ platform: 'netease' }),
  }))
})

test('deletion during login check does not repopulate refresh state or update storage', async () => {
  const { session, registry, store, logger } = fixture('deleted-in-flight')
  let resolveCheck
  const callModule = jest.fn(() => new Promise(resolve => { resolveCheck = resolve }))
  const pending = ensureQQLoginFresh(session, { registry, accountStore: store, logger, platformFactory: { getPlatform: () => ({ callModule }) } })
  registry.byAccessKey.delete(session.apiAccessKey)
  registry.sessions.length = 0
  require('../../../dist/loginRefresh').clearAccountLoginRefresh(session.apiAccessKey)
  resolveCheck({ code: 200, expired: true })
  await pending
  expect(store.update).not.toHaveBeenCalled()
  expect(qqNextLoginCheckAt.has(session.apiAccessKey)).toBe(false)
  expect(callModule).toHaveBeenCalledTimes(1)
})
