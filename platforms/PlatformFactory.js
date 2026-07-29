/**
 * 平台工厂类
 * 管理所有音乐平台适配器的注册、创建和调用
 */
class PlatformFactory {
  constructor() {
    this.platforms = new Map()
    this.defaultPlatform = 'netease'
    this.initialized = false
  }

  /**
   * 注册平台适配器
   * @param {string} name - 平台名称
   * @param {Class} PlatformClass - 平台适配器类
   * @param {Object} config - 平台配置
   */
  register(name, PlatformClass, config = {}) {
    try {
      const platformInstance = new PlatformClass({ ...config, name })
      this.platforms.set(name, platformInstance)

      console.log(`Platform ${name} registered successfully`)
      return true
    } catch (error) {
      console.error(`Failed to register platform ${name}:`, error.message)
      return false
    }
  }

  /**
   * 初始化所有平台
   */
  async initialize() {
    if (this.initialized) {
      return true
    }

    const initPromises = []
    for (const [name, platform] of this.platforms) {
      initPromises.push(
        platform.initialize().catch(error => {
          console.error(`Failed to initialize platform ${name}:`, error.message)
          return { name, error }
        })
      )
    }

    const results = await Promise.allSettled(initPromises)
    const failed = results.filter(r => r.status === 'rejected' || r.value?.error)

    if (failed.length > 0) {
      console.warn(`${failed.length} platforms failed to initialize`)
    }

    this.initialized = true
    return true
  }

  /**
   * 获取平台实例
   * @param {string} platformName - 平台名称
   * @returns {Object|null} 平台实例
   */
  getPlatform(platformName) {
    // 如果没有指定平台，使用默认平台
    const name = platformName || this.defaultPlatform

    const platform = this.platforms.get(name)
    if (!platform) {
      throw new Error(`Platform '${name}' is not registered. Available platforms: ${this.getAvailablePlatforms().join(', ')}`)
    }

    return platform
  }

  /**
   * 获取所有可用平台列表
   * @returns {Array} 平台名称数组
   */
  getAvailablePlatforms() {
    return Array.from(this.platforms.keys())
  }

  /**
   * 获取所有可用平台支持的路由
   * @returns {Array} 平台路由数组
   */
  getAvailableRoutes() {
    const routes = new Set()
    for (const [, platform] of this.platforms) {
        const modules = platform.modules
        if (modules) {
          for (const route of modules.keys()) {
              routes.add(route)
          }
        }
    }
    return Array.from(routes)
  }

  /**
   * 检查平台是否存在
   * @param {string} platformName - 平台名称
   * @returns {boolean} 是否存在
   */
  hasPlatform(platformName) {
    return this.platforms.has(platformName)
  }

  /**
   * 设置默认平台
   * @param {string} platformName - 平台名称
   */
  setDefaultPlatform(platformName) {
    if (!this.hasPlatform(platformName)) {
      throw new Error(`Cannot set default platform to '${platformName}': platform not registered`)
    }
    this.defaultPlatform = platformName
  }

  /**
   * 获取默认平台名称
   * @returns {string} 默认平台名称
   */
  getDefaultPlatform() {
    return this.defaultPlatform
  }


  /**
   * 重置工厂（清除所有平台）
   */
  reset() {
    this.platforms.clear()
    this.initialized = false
    this.defaultPlatform = 'netease'
  }
}

// 创建全局单例
const platformFactory = new PlatformFactory()

module.exports = platformFactory