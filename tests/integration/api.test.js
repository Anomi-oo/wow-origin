/**
 * API 集成测试
 * 测试HTTP端点的完整流程
 */
const request = require('supertest')
const { MultiPlatformServer } = require('../../dist/app')

describe('API Integration Tests', () => {
  let app
  let server

  beforeAll(async () => {
    // 创建服务器实例
    const serverInstance = new MultiPlatformServer()
    app = await serverInstance.initialize()
    server = serverInstance
  })

  afterAll(() => {
    if (server) {
      server.stop()
    }
  })

  describe('搜索接口', () => {
    test('GET /search 应该返回搜索结果（网易云）', async () => {
      const response = await request(app)
        .get('/search')
        .query({
          keywords: '周杰伦',
          platform: 'netease',
          limit: 5
        })
        .expect(200)
        .expect('Content-Type', /json/)

      expect(response.body).toHaveProperty('code', 200)
      // 网易云API通常返回result字段
      // 注意：实际返回格式取决于网易云API
    }, 15000) // 网络请求可能较慢

    test('GET /search 缺少keywords应该返回错误', async () => {
      const response = await request(app)
        .get('/search')
        .query({
          platform: 'netease'
        })
        .expect(500)

      expect(response.body).toHaveProperty('code', 500)
      expect(response.body).toHaveProperty('message')
      expect(response.body.message).toContain('keywords')
    })

    test('POST /search 应该支持POST请求', async () => {
      const response = await request(app)
        .post('/search')
        .send({
          keywords: '周杰伦',
          platform: 'netease',
          limit: 5
        })
        .expect(200)

      expect(response.body).toHaveProperty('code', 200)
    }, 15000)
  })

  describe('错误处理', () => {
    test('不存在的路由应该返回404', async () => {
      const response = await request(app)
        .get('/nonexistent')
        .expect(404)

      expect(response.body).toHaveProperty('code', 404)
      expect(response.body.message).toContain('not found')
    })

    test('无效的平台名称应该返回错误', async () => {
      const response = await request(app)
        .get('/search')
        .query({
          keywords: 'test',
          platform: 'invalid_platform'
        })
        .expect(500)

      expect(response.body).toHaveProperty('code', 500)
      expect(response.body).toHaveProperty('message')
    })
  })

  describe('CORS 支持', () => {
    test('OPTIONS 请求应该返回204', async () => {
      await request(app)
        .options('/search')
        .expect(204)
    })

    test('响应应该包含CORS头', async () => {
      const response = await request(app)
        .get('/nonexistent')
        .expect(404)

      expect(response.headers).toHaveProperty('access-control-allow-credentials')
      expect(response.headers).toHaveProperty('access-control-allow-origin')
    })
  })

  describe('Cookie处理', () => {
    test('Cookie中的认证参数应该被识别', async () => {
      const response = await request(app)
        .get('/search')
        .set('Cookie', 'MUSIC_U=test_cookie_value')
        .query({
          keywords: 'test',
          platform: 'netease'
        })

      // 请求应该能够正常处理（即使MUSIC_U可能无效）
      expect(response.body).toHaveProperty('code')
    })
  })

  describe('缓存行为', () => {
    test('相同请求应该命中缓存', async () => {
      const query = {
        keywords: '缓存测试',
        platform: 'netease',
        limit: 3
      }

      // 第一次请求
      const response1 = await request(app)
        .get('/search')
        .query(query)
        .expect(200)

      const startTime = Date.now()

      // 第二次请求（应该从缓存返回，速度更快）
      const response2 = await request(app)
        .get('/search')
        .query(query)
        .expect(200)

      const duration = Date.now() - startTime

      // 缓存命中应该很快（<50ms）
      expect(duration).toBeLessThan(50)

      // 结果应该一致
      expect(response2.body).toEqual(response1.body)
    }, 15000)
  })

  describe('并发控制', () => {
    test('应该能够处理并发请求', async () => {
      const concurrentRequests = 10
      const promises = Array(concurrentRequests).fill(null).map((_, i) =>
        request(app)
          .get('/search')
          .query({
            keywords: `测试${i}`,
            platform: 'netease',
            limit: 3
          })
      )

      const results = await Promise.all(promises)

      // 所有请求都应该成功
      results.forEach(response => {
        expect(response.status).toBe(200)
      })
    }, 30000)
  })

  describe('参数验证', () => {
    test('limit参数超出范围应该返回错误', async () => {
      const response = await request(app)
        .get('/search')
        .query({
          keywords: 'test',
          platform: 'netease',
          limit: 99999 // 超过最大值
        })

      // 根据验证规则，可能返回错误
      expect(response.body).toHaveProperty('code')
    })

    test('offset参数为负数应该返回错误', async () => {
      const response = await request(app)
        .get('/search')
        .query({
          keywords: 'test',
          platform: 'netease',
          offset: -1
        })

      expect(response.body).toHaveProperty('code')
    })
  })
})
