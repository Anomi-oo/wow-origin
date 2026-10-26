const request = require('supertest');

const { MultiPlatformServer } = require('../../dist/app');

function fakeAccountStore() {
  const accounts = new Map();
  const remote = [];
  const store = {
    location: 'memory://edgeone-sync',
    remote,
    reloadCalls: 0,
    list: () => [...accounts.values()].map((account) => ({ ...account })),
    insert(account) {
      accounts.set(account.api_access_key, { ...account });
    },
    update(apiAccessKey, changes) {
      accounts.set(apiAccessKey, { ...accounts.get(apiAccessKey), ...changes, api_access_key: apiAccessKey });
    },
    delete(apiAccessKey) {
      accounts.delete(apiAccessKey);
    },
    async reload() {
      store.reloadCalls += 1;
      if (remote.length === 0) return false;
      for (const account of remote.splice(0)) {
        accounts.set(account.api_access_key, { ...account });
      }
      return true;
    }
  };
  return store;
}

function account(apiAccessKey) {
  return {
    platform: 'netease',
    name: apiAccessKey,
    cookie: '',
    api_access_key: apiAccessKey,
    stateless: false,
    useLuoxue: false,
    lxSource: []
  };
}

test('新实例会同步其他实例创建的账号，并限制强制刷新的频率', async () => {
  const now = 1_700_000_000_000;
  const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
  const store = fakeAccountStore();
  const server = new MultiPlatformServer({
    accountStore: store,
    lxSourceManager: {
      reconcileAccountSources() {},
      getTrackUrl: async () => null,
      handleTrackUrl: async () => null,
      update: async () => {},
      dispose() {}
    },
    edgeone: true,
    serveStatic: false,
    preload: false
  });

  try {
    const app = await server.initialize();

    store.remote.push(account('remote-1'));
    clock.mockReturnValue(now + 3_000);
    const first = await request(app).post('/login/api/verify-key').send({ api_access_key: 'remote-1' }).expect(200);
    expect(first.body.data.apiAccessKey).toBe('remote-1');
    expect(store.reloadCalls).toBe(1);

    // 2 秒内再次遇到未知 key 时不应继续读取 Blob。
    store.remote.push(account('remote-2'));
    clock.mockReturnValue(now + 4_000);
    await request(app).post('/login/api/verify-key').send({ api_access_key: 'remote-2' }).expect(400);
    expect(store.reloadCalls).toBe(1);

    // 超过 2 秒后允许再次强制同步。
    clock.mockReturnValue(now + 5_000);
    await request(app).post('/login/api/verify-key').send({ api_access_key: 'remote-2' }).expect(200);
    expect(store.reloadCalls).toBe(2);
  } finally {
    clock.mockRestore();
  }
});
