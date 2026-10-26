const request = require('supertest');

const { MultiPlatformServer } = require('../../dist/app');

function failingStore() {
  return {
    location: 'memory://edgeone-test',
    list: () => [],
    insert() {},
    update() {},
    delete() {},
    flush: async () => {
      const error = new Error('blob unavailable');
      error.code = 'ETEST';
      throw error;
    }
  };
}

test('写请求持久化失败时返回完整的 500 JSON', async () => {
  const server = new MultiPlatformServer({
    accountStore: failingStore(),
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
  const app = await server.initialize();

  const response = await request(app).post('/login/api/start').send({ platform: 'not-a-platform' }).expect(500);

  expect(response.headers['content-type']).toMatch(/application\/json/);
  expect(response.headers['content-length']).toBe(String(Buffer.byteLength(JSON.stringify(response.body))));
  expect(response.body).toEqual({
    code: 500,
    message: '账号状态持久化失败',
    data: null
  });
});
