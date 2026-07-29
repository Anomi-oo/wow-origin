/**
 * BasePlatform 单元测试
 * 测试平台基类的核心功能
 */
const BasePlatform = require('../../../platforms/base/BasePlatform')

// 创建测试用的平台子类
class TestPlatform extends BasePlatform {
  constructor(config = {}) {
    super({ name: 'test', ...config })
    this.requestCalled = false
  }

  async doInitialize() {
    // 手动添加测试模块（不需要keywords验证的简单模块）
    this.modules.set('status', async (query) => {
      return { status: 'ok', query }
    })

    this.modules.set('detail', async (query) => {
      if (!query.id) {
        throw new Error('id is required')
      }
      return { id: query.id, name: 'test' }
    })
  }

  createRequestFunction() {
    return async (uri, data, options) => {
      this.requestCalled = true
      return { uri, data, options }
    }
  }
}

describe('BasePlatform', () => {
  let platform

  beforeEach(async () => {
    platform = new TestPlatform({ enableCache: true })
    await platform.initialize()
  })

  afterEach(() => {
    if (platform && platform.cache) {
      platform.cache.clear()
    }
  })

  describe('初始化', () => {
    test('应该正确初始化平台', async () => {
      expect(platform.initialized).toBe(true)
      expect(platform.name).toBe('test')
      expect(platform.modules.size).toBe(2)
    })

    test('重复初始化应该直接返回', async () => {
      const result = await platform.initialize()
      expect(result).toBe(true)
      expect(platform.modules.size).toBe(2) // 不会重复加载
    })

    test('初始化失败应该抛出错误', async () => {
      class FailPlatform extends BasePlatform {
        async doInitialize() {
          throw new Error('Init failed')
        }
        createRequestFunction() {
          return async () => {}
        }
      }

      const failPlatform = new FailPlatform({ name: 'fail' })
      await expect(failPlatform.initialize()).rejects.toThrow('Init failed')
    })
  })

  describe('模块调用', () => {
    test('不在 module 层记录请求日志', async () => {
      const requestLog = jest.spyOn(platform.logger, 'request')
      const req = {
        query: { platform: 'test' },
        body: {},
        ip: '127.0.0.1',
        connection: {}
      }

      await platform.callModule('status', req)

      expect(requestLog).not.toHaveBeenCalled()
    })

    test('应该成功调用模块', async () => {
      const req = {
        query: { platform: 'test', param1: 'value1' },
        body: {},
        ip: '127.0.0.1',
        connection: {}
      }

      const result = await platform.callModule('status', req)

      expect(result.code).toBe(200)
      expect(result.status).toBe('ok')
    })

    test('应该合并query和body参数', async () => {
      const req = {
        query: { platform: 'test', param1: 'value1' },
        body: { param2: 'value2' },
        ip: '127.0.0.1',
        connection: {}
      }

      const result = await platform.callModule('status', req)

      expect(result.code).toBe(200)
      expect(result.query.param1).toBe('value1')
      expect(result.query.param2).toBe('value2')
    })

    test('模块不存在应该返回错误', async () => {
      const req = {
        query: { platform: 'test' },
        body: {},
        ip: '127.0.0.1',
        connection: {}
      }

      const result = await platform.callModule('nonexistent', req)

      expect(result.code).toBe(500)
      expect(result.message).toContain('not found')
    })

    test('平台名称不匹配应该返回错误', async () => {
      const req = {
        query: { platform: 'other' },
        body: {},
        ip: '127.0.0.1',
        connection: {}
      }

      const result = await platform.callModule('status', req)

      expect(result.code).toBe(500)
      expect(result.message).toContain('Platform mismatch')
    })

    test('模块抛出错误应该返回错误结果', async () => {
      const req = {
        query: { platform: 'test' }, // 缺少id参数
        body: {},
        ip: '127.0.0.1',
        connection: {}
      }

      const result = await platform.callModule('detail', req)

      expect(result.code).toBe(500)
      expect(result.message).toContain('id is required')
    })
  })

  describe('缓存功能', () => {
    test('应该缓存成功的结果', async () => {
      const req = {
        query: { platform: 'test', param1: 'value1' },
        body: {},
        ip: '127.0.0.1',
        connection: {}
      }

      // 第一次调用
      const result1 = await platform.callModule('status', req)
      expect(result1.code).toBe(200)

      // 第二次调用应该从缓存读取
      const result2 = await platform.callModule('status', req)
      expect(result2.code).toBe(200)
      expect(result2).toEqual(result1)

      // 验证缓存命中
      const stats = platform.cache.getStats()
      expect(stats.hits).toBeGreaterThanOrEqual(1)
    })

    test('禁用缓存时不应该缓存', async () => {
      const noCachePlatform = new TestPlatform({ enableCache: false })
      await noCachePlatform.initialize()

      const req = {
        query: { platform: 'test', param1: 'value1' },
        body: {},
        ip: '127.0.0.1',
        connection: {}
      }

      await noCachePlatform.callModule('status', req)
      await noCachePlatform.callModule('status', req)

      const stats = noCachePlatform.cache.getStats()
      expect(stats.hits).toBe(0) // 缓存未启用，无命中
    })

    test('错误结果不应该缓存', async () => {
      const req = {
        query: { platform: 'test' }, // 缺少id
        body: {},
        ip: '127.0.0.1',
        connection: {}
      }

      // 第一次调用（失败）
      await platform.callModule('detail', req)

      // 验证没有缓存成功的结果
      const initialSize = platform.cache.getStats().size

      // 第二次调用
      await platform.callModule('detail', req)

      // 缓存大小不应该增加
      expect(platform.cache.getStats().size).toBe(initialSize)
    })
  })

  describe('参数验证', () => {
    test('应该验证通用参数', () => {
      const validation = platform.validateQuery({ limit: 'invalid' }, 'status')

      // limit应该是integer类型
      expect(validation.valid).toBe(false)
      expect(validation.errors.length).toBeGreaterThan(0)
    })

    test('有效参数应该通过验证', () => {
      const validation = platform.validateQuery(
        { limit: 10, offset: 0 },
        'status'
      )

      expect(validation.valid).toBe(true)
      expect(validation.errors.length).toBe(0)
    })
  })

  describe('TTL解析', () => {
    test('应该优先使用ttlMinutes', () => {
      const config = { ttlMinutes: 10 }
      const ttl = platform._resolveTTL(config)

      expect(ttl).toBe(10 * 60 * 1000) // 10分钟转换为毫秒
    })

    test('应该使用ttl作为后备', () => {
      const config = { ttl: 5000 }
      const ttl = platform._resolveTTL(config)

      expect(ttl).toBe(5000)
    })

    test('应该使用默认TTL', () => {
      const config = {}
      const ttl = platform._resolveTTL(config)

      expect(ttl).toBe(platform.defaultTTL)
    })
  })

  describe('边界情况', () => {
    test('应该处理空的query和body', async () => {
      const req = {
        query: { platform: 'test' },
        body: {},
        ip: '127.0.0.1',
        connection: {}
      }

      const result = await platform.callModule('status', req)

      expect(result).toBeDefined()
      expect(result.code).toBe(200)
    })

    test('应该处理缺少IP的请求', async () => {
      const req = {
        query: { platform: 'test' },
        body: {},
        connection: {}
        // 没有ip字段
      }

      const result = await platform.callModule('status', req)

      // 应该能够正常处理
      expect(result.code).toBe(200)
    })
  })
})
