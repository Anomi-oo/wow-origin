const { refreshLoginSessions } = require('../../../src/loginRefresh.ts')

test('QQ 刷新凭证会合并并持久化新的 Cookie', async () => {
  const account = {
    platform: 'qq', name: 'QQ', api_access_key: 'key-1',
    cookie: 'uin=123; qm_keyst=old; refresh_token=keep',
  }
  const session = {
    platform: 'qq', name: 'QQ', apiAccessKey: 'key-1', cookie: account.cookie,
    stateless: true, useLuoxue: true, lxSource: [], favoriteTrackIds: new Set(),
  }
  const registry = { sessions: [session], byAccessKey: new Map([['key-1', session]]) }
  const store = {
    location: 'memory',
    list: () => [account],
    insert: jest.fn(),
    update: jest.fn((_key, changes) => Object.assign(account, changes)),
  }
  const callModule = jest.fn(async () => ({
    code: 200, refreshed: true,
    cookie: { uin: '123', qm_keyst: 'new', refresh_key: 'new-refresh-key' },
  }))
  const logger = { info: jest.fn(), error: jest.fn(), warn: jest.fn() }

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
