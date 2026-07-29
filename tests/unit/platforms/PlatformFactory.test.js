/**
 * PlatformFactory 单元测试
 * 测试平台工厂的管理功能
 */
const platformFactory = require('../../../platforms/PlatformFactory')
const BasePlatform = require('../../../platforms/base/BasePlatform')

// 创建测试平台类
class TestPlatform1 extends BasePlatform {
  async doInitialize() {
    this.modules.set('test', async () => ({ result: 'test1' }))
  }
  createRequestFunction() {
    return async () => ({ data: 'test1' })
  }
}

class TestPlatform2 extends BasePlatform {
  async doInitialize() {
    this.modules.set('test', async () => ({ result: 'test2' }))
    this.modules.set('extra', async () => ({ result: 'extra' }))
  }
  createRequestFunction() {
    return async () => ({ data: 'test2' })
  }
}

class FailingPlatform extends BasePlatform {
  async doInitialize() {
    throw new Error('Init failed')
  }
  createRequestFunction() {
    return async () => ({})
  }
}

describe('PlatformFactory', () => {
  beforeEach(() => {
    // 重置工厂状态
    platformFactory.reset()
  })

  describe('平台注册', () => {
    test('应该成功注册平台', () => {
      const result = platformFactory.register('test1', TestPlatform1, { name: 'test1' })

      expect(result).toBe(true)
      expect(platformFactory.hasPlatform('test1')).toBe(true)
    })

    test('应该注册多个平台', () => {
      platformFactory.register('test1', TestPlatform1, { name: 'test1' })
      platformFactory.register('test2', TestPlatform2, { name: 'test2' })

      expect(platformFactory.hasPlatform('test1')).toBe(true)
      expect(platformFactory.hasPlatform('test2')).toBe(true)
    })

    test('注册失败应该返回false', () => {
      // 传入无效的配置导致构造失败
      const result = platformFactory.register('invalid', null, {})

      expect(result).toBe(false)
    })

    test('应该传递配置给平台', () => {
      const config = { name: 'test1', customOption: 'value' }
      platformFactory.register('test1', TestPlatform1, config)

      const platform = platformFactory.getPlatform('test1')
      expect(platform.name).toBe('test1')
      expect(platform.config.customOption).toBe('value')
    })
  })

  describe('平台初始化', () => {
    test('应该初始化所有平台', async () => {
      platformFactory.register('test1', TestPlatform1, { name: 'test1' })
      platformFactory.register('test2', TestPlatform2, { name: 'test2' })

      const result = await platformFactory.initialize()

      expect(result).toBe(true)
      expect(platformFactory.initialized).toBe(true)
    })

    test('重复初始化应该直接返回', async () => {
      platformFactory.register('test1', TestPlatform1, { name: 'test1' })

      await platformFactory.initialize()
      expect(platformFactory.initialized).toBe(true)

      const result = await platformFactory.initialize()
      expect(result).toBe(true)
    })

    test('部分平台初始化失败不应该中断其他平台', async () => {
      platformFactory.register('test1', TestPlatform1, { name: 'test1' })
      platformFactory.register('failing', FailingPlatform, { name: 'failing' })
      platformFactory.register('test2', TestPlatform2, { name: 'test2' })

      const result = await platformFactory.initialize()

      // 初始化应该继续
      expect(result).toBe(true)

      // 成功的平台应该可用
      expect(platformFactory.getPlatform('test1')).toBeDefined()
      expect(platformFactory.getPlatform('test2')).toBeDefined()
    })
  })

  describe('平台获取', () => {
    beforeEach(async () => {
      platformFactory.register('test1', TestPlatform1, { name: 'test1' })
      platformFactory.register('test2', TestPlatform2, { name: 'test2' })
      await platformFactory.initialize()
      platformFactory.setDefaultPlatform('test1') // 设置默认平台为test1
    })

    test('应该获取已注册的平台', () => {
      const platform = platformFactory.getPlatform('test1')

      expect(platform).toBeDefined()
      expect(platform.name).toBe('test1')
    })

    test('未指定平台名应该返回默认平台', () => {
      const platform = platformFactory.getPlatform()

      expect(platform).toBeDefined()
      expect(platform.name).toBe('test1') // 应该返回设置的默认平台
    })

    test('获取不存在的平台应该抛出错误', () => {
      expect(() => {
        platformFactory.getPlatform('nonexistent')
      }).toThrow(/not registered/)
    })

    test('错误消息应该包含可用平台列表', () => {
      try {
        platformFactory.getPlatform('nonexistent')
      } catch (error) {
        expect(error.message).toContain('test1')
        expect(error.message).toContain('test2')
      }
    })
  })

  describe('平台查询', () => {
    beforeEach(() => {
      platformFactory.register('test1', TestPlatform1, { name: 'test1' })
      platformFactory.register('test2', TestPlatform2, { name: 'test2' })
    })

    test('getAvailablePlatforms应该返回所有平台名称', () => {
      const platforms = platformFactory.getAvailablePlatforms()

      expect(platforms).toContain('test1')
      expect(platforms).toContain('test2')
      expect(platforms.length).toBe(2)
    })

    test('hasPlatform应该检查平台是否存在', () => {
      expect(platformFactory.hasPlatform('test1')).toBe(true)
      expect(platformFactory.hasPlatform('test2')).toBe(true)
      expect(platformFactory.hasPlatform('nonexistent')).toBe(false)
    })

    test('getAvailableRoutes应该返回所有路由', async () => {
      await platformFactory.initialize()
      const routes = platformFactory.getAvailableRoutes()

      expect(routes).toContain('test')
      expect(routes).toContain('extra')
      expect(routes.length).toBe(2) // test和extra（去重）
    })

    test('空工厂应该返回空路由列表', () => {
      platformFactory.reset()
      const routes = platformFactory.getAvailableRoutes()

      expect(routes).toEqual([])
    })
  })

  describe('默认平台管理', () => {
    beforeEach(() => {
      platformFactory.register('test1', TestPlatform1, { name: 'test1' })
      platformFactory.register('test2', TestPlatform2, { name: 'test2' })
    })

    test('应该返回默认平台', () => {
      const defaultPlatform = platformFactory.getDefaultPlatform()

      expect(defaultPlatform).toBe('netease') // 默认是netease
    })

    test('应该设置默认平台', () => {
      platformFactory.setDefaultPlatform('test1')

      expect(platformFactory.getDefaultPlatform()).toBe('test1')
    })

    test('设置不存在的默认平台应该抛出错误', () => {
      expect(() => {
        platformFactory.setDefaultPlatform('nonexistent')
      }).toThrow(/not registered/)
    })

    test('getPlatform无参数应该使用默认平台', async () => {
      await platformFactory.initialize()
      platformFactory.setDefaultPlatform('test2')

      const platform = platformFactory.getPlatform()

      expect(platform.name).toBe('test2')
    })
  })

  describe('工厂重置', () => {
    test('reset应该清空所有平台', () => {
      platformFactory.register('test1', TestPlatform1, { name: 'test1' })
      platformFactory.register('test2', TestPlatform2, { name: 'test2' })

      expect(platformFactory.getAvailablePlatforms().length).toBe(2)

      platformFactory.reset()

      expect(platformFactory.getAvailablePlatforms().length).toBe(0)
    })

    test('reset应该重置初始化状态', async () => {
      platformFactory.register('test1', TestPlatform1, { name: 'test1' })
      await platformFactory.initialize()

      expect(platformFactory.initialized).toBe(true)

      platformFactory.reset()

      expect(platformFactory.initialized).toBe(false)
    })

    test('reset应该重置默认平台', () => {
      platformFactory.register('test1', TestPlatform1, { name: 'test1' })
      platformFactory.setDefaultPlatform('test1')

      platformFactory.reset()

      expect(platformFactory.getDefaultPlatform()).toBe('netease')
    })
  })

  describe('边界情况', () => {
    test('应该处理空平台列表', () => {
      expect(platformFactory.getAvailablePlatforms()).toEqual([])
      expect(platformFactory.getAvailableRoutes()).toEqual([])
    })

    test('应该处理未初始化的平台模块', () => {
      platformFactory.register('test1', TestPlatform1, { name: 'test1' })
      // 不调用initialize

      const routes = platformFactory.getAvailableRoutes()
      // 未初始化的平台modules为空
      expect(routes).toEqual([])
    })

    test('应该处理大量平台注册', async () => {
      // 注册10个平台
      for (let i = 0; i < 10; i++) {
        platformFactory.register(`test${i}`, TestPlatform1, { name: `test${i}` })
      }

      await platformFactory.initialize()

      expect(platformFactory.getAvailablePlatforms().length).toBe(10)
    })
  })
})
