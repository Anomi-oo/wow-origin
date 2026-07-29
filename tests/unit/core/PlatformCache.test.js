/**
 * PlatformCache 单元测试
 * 测试LRU缓存的核心功能
 */
const { PlatformCache } = require('../../../core/PlatformCache')

describe('PlatformCache', () => {
  let cache

  beforeEach(() => {
    // 每个测试前创建新的缓存实例
    cache = new PlatformCache({ maxSize: 3, defaultTTL: 1000 })
  })

  afterEach(() => {
    // 清理缓存
    cache.clear()
  })

  describe('基本功能', () => {
    test('应该能够设置和获取缓存', () => {
      cache.set('netease', 'search', { keywords: 'test' }, 'result1')
      const result = cache.get('netease', 'search', { keywords: 'test' })

      expect(result).toBe('result1')
    })

    test('缓存键应该忽略系统参数', () => {
      const params1 = { keywords: 'test', ip: '127.0.0.1', platform: 'netease' }
      const params2 = { keywords: 'test', ip: '192.168.1.1', platform: 'qqmusic' }

      cache.set('netease', 'search', params1, 'result1')
      const result = cache.get('netease', 'search', params2)

      // 系统参数不同，但用户参数相同，应该命中缓存
      expect(result).toBe('result1')
    })

    test('不同的用户参数应该产生不同的缓存键', () => {
      cache.set('netease', 'search', { keywords: 'test1' }, 'result1')
      cache.set('netease', 'search', { keywords: 'test2' }, 'result2')

      expect(cache.get('netease', 'search', { keywords: 'test1' })).toBe('result1')
      expect(cache.get('netease', 'search', { keywords: 'test2' })).toBe('result2')
    })

    test('缓存未命中应该返回null', () => {
      const result = cache.get('netease', 'search', { keywords: 'nonexistent' })
      expect(result).toBeNull()
    })
  })

  describe('LRU淘汰策略', () => {
    test('超过maxSize应该淘汰最老的项', () => {
      cache.set('netease', 'search', { q: '1' }, 'r1')
      cache.set('netease', 'search', { q: '2' }, 'r2')
      cache.set('netease', 'search', { q: '3' }, 'r3')
      cache.set('netease', 'search', { q: '4' }, 'r4') // 触发LRU淘汰

      expect(cache.get('netease', 'search', { q: '1' })).toBeNull() // 最老的被淘汰
      expect(cache.get('netease', 'search', { q: '2' })).toBe('r2')
      expect(cache.get('netease', 'search', { q: '3' })).toBe('r3')
      expect(cache.get('netease', 'search', { q: '4' })).toBe('r4')
    })

    test('访问缓存项应该更新其位置', () => {
      cache.set('netease', 'search', { q: '1' }, 'r1')
      cache.set('netease', 'search', { q: '2' }, 'r2')
      cache.set('netease', 'search', { q: '3' }, 'r3')

      // 访问第一个项，使其成为最新
      cache.get('netease', 'search', { q: '1' })

      // 添加新项，应该淘汰q=2（现在是最老的）
      cache.set('netease', 'search', { q: '4' }, 'r4')

      expect(cache.get('netease', 'search', { q: '1' })).toBe('r1') // 被访问过，未被淘汰
      expect(cache.get('netease', 'search', { q: '2' })).toBeNull() // 最老的被淘汰
      expect(cache.get('netease', 'search', { q: '3' })).toBe('r3')
      expect(cache.get('netease', 'search', { q: '4' })).toBe('r4')
    })
  })

  describe('TTL过期机制', () => {
    test('过期的缓存项应该返回null', (done) => {
      cache.set('netease', 'search', { keywords: 'test' }, 'result1', 100) // 100ms TTL

      // 立即访问应该成功
      expect(cache.get('netease', 'search', { keywords: 'test' })).toBe('result1')

      // 等待过期后访问
      setTimeout(() => {
        expect(cache.get('netease', 'search', { keywords: 'test' })).toBeNull()
        done()
      }, 150)
    })

    test('更新缓存应该刷新TTL', (done) => {
      cache.set('netease', 'search', { keywords: 'test' }, 'result1', 100)

      setTimeout(() => {
        // 更新值，刷新TTL
        cache.set('netease', 'search', { keywords: 'test' }, 'result2', 200)

        setTimeout(() => {
          // 原TTL已过，但因为更新了，所以还在
          expect(cache.get('netease', 'search', { keywords: 'test' })).toBe('result2')
          done()
        }, 50)
      }, 60)
    })
  })

  describe('缓存管理', () => {
    test('clear应该清空所有缓存', () => {
      cache.set('netease', 'search', { q: '1' }, 'r1')
      cache.set('netease', 'search', { q: '2' }, 'r2')

      cache.clear()

      expect(cache.get('netease', 'search', { q: '1' })).toBeNull()
      expect(cache.get('netease', 'search', { q: '2' })).toBeNull()
      expect(cache.getStats().size).toBe(0)
    })

    test('clearRoute应该只清除特定路由的缓存', () => {
      cache.set('netease', 'search', { q: '1' }, 'r1')
      cache.set('netease', 'search', { q: '2' }, 'r2')
      cache.set('netease', 'song/detail', { id: '123' }, 'r3')

      const deleted = cache.clearRoute('netease', 'search')

      expect(deleted).toBe(2)
      expect(cache.get('netease', 'search', { q: '1' })).toBeNull()
      expect(cache.get('netease', 'search', { q: '2' })).toBeNull()
      expect(cache.get('netease', 'song/detail', { id: '123' })).toBe('r3') // 未被清除
    })

    test('cleanup应该清除过期项', (done) => {
      cache.set('netease', 'search', { q: '1' }, 'r1', 100) // 100ms TTL
      cache.set('netease', 'search', { q: '2' }, 'r2', 5000) // 5s TTL

      setTimeout(() => {
        const cleaned = cache.cleanup()

        expect(cleaned).toBe(1) // 清除了1个过期项
        expect(cache.get('netease', 'search', { q: '1' })).toBeNull()
        expect(cache.get('netease', 'search', { q: '2' })).toBe('r2')
        done()
      }, 150)
    })
  })

  describe('统计信息', () => {
    test('应该正确统计命中和未命中', () => {
      cache.set('netease', 'search', { keywords: 'test' }, 'result1')

      cache.get('netease', 'search', { keywords: 'test' }) // 命中
      cache.get('netease', 'search', { keywords: 'test' }) // 命中
      cache.get('netease', 'search', { keywords: 'miss' }) // 未命中

      const stats = cache.getStats()

      expect(stats.hits).toBe(2)
      expect(stats.misses).toBe(1)
      expect(stats.hitRate).toBeCloseTo(0.67, 2)
    })

    test('应该统计缓存大小', () => {
      expect(cache.getStats().size).toBe(0)

      cache.set('netease', 'search', { q: '1' }, 'r1')
      cache.set('netease', 'search', { q: '2' }, 'r2')

      const stats = cache.getStats()
      expect(stats.size).toBe(2)
      expect(stats.maxSize).toBe(3)
    })
  })

  describe('边界情况', () => {
    test('应该处理空参数对象', () => {
      cache.set('netease', 'status', {}, 'result1')
      const result = cache.get('netease', 'status', {})

      expect(result).toBe('result1')
    })

    test('应该处理参数顺序不同的情况', () => {
      cache.set('netease', 'search', { keywords: 'test', limit: 10 }, 'result1')
      const result = cache.get('netease', 'search', { limit: 10, keywords: 'test' })

      // 参数顺序不同，但内容相同，应该命中
      expect(result).toBe('result1')
    })

    test('maxSize=1时应该正常工作', () => {
      const smallCache = new PlatformCache({ maxSize: 1 })

      smallCache.set('netease', 'search', { q: '1' }, 'r1')
      smallCache.set('netease', 'search', { q: '2' }, 'r2')

      expect(smallCache.get('netease', 'search', { q: '1' })).toBeNull()
      expect(smallCache.get('netease', 'search', { q: '2' })).toBe('r2')
    })
  })
})

describe('BasePlatform TTL 解析', () => {
  test('支持计算到下一个本地 0 点的 TTL', () => {
    const BasePlatform = require('../../../platforms/base/BasePlatform')
    const platform = new BasePlatform({ name: 'test' })

    const ttl = platform._millisecondsUntilNextLocalMidnight(new Date(2026, 0, 1, 23, 30, 0, 0))

    expect(ttl).toBe(30 * 60 * 1000)
  })

  test('可按参数决定是否使用到 0 点 TTL', () => {
    const BasePlatform = require('../../../platforms/base/BasePlatform')
    const platform = new BasePlatform({ name: 'test' })

    expect(platform._shouldUseMidnightTTL({ ttlUntilMidnightParams: ['category', 'cat'] }, { category: '3317' })).toBe(true)
    expect(platform._shouldUseMidnightTTL({ ttlUntilMidnightParams: ['category', 'cat'] }, {})).toBe(false)
  })

  test('支持按参数启用路由缓存', () => {
    const BasePlatform = require('../../../platforms/base/BasePlatform')
    const platform = new BasePlatform({ name: 'test' })

    expect(platform._isRouteCacheEnabled({ enabled: true, enabledWhenParams: ['toplistTrackCache'] }, {})).toBe(false)
    expect(platform._isRouteCacheEnabled({ enabled: true, enabledWhenParams: ['toplistTrackCache'] }, { toplistTrackCache: '1' })).toBe(true)
  })
})
