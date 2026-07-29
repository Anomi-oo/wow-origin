const Result = require('../../core/Result')
const Logger = require('../../core/Logger')
const PlatformConfig = require('../../core/PlatformConfig')
const { globalCache } = require('../../core/PlatformCache')
const { globalLimiter } = require('../../core/ConcurrencyLimiter')

/**
 * 音乐平台基础抽象类
 * 定义所有平台必须实现的标准接口
 */
class BasePlatform {
  constructor(config = {}) {
    this.name = config.name || 'unknown'
    this.config = config
    this.modules = new Map()
    this.initialized = false
    this.logger = new Logger({ platform: this.name })

    // 使用全局缓存实例
    this.cache = globalCache
    this.cacheEnabled = config.enableCache !== false
    this.defaultTTL = config.defaultTTL || 300000
  }


  /**
   * 平台初始化
   */
  async initialize() {
    if (this.initialized) {
      return true
    }

    try {
      // 子类可以重写此方法实现具体初始化逻辑
      await this.doInitialize()

      this.initialized = true
      this.logger.compact('platform', `${this.name} Platform initialized | ${this.modules.size} modules`, 'debug')

      return true
    } catch (error) {
      this.logger.error(`Platform ${this.name} initialization failed`, error)
      throw error
    }
  }

  /**
   * 子类需要实现的初始化逻辑
   */
  async doInitialize() {
    throw new Error('doInitialize method must be implemented by subclass')
  }

  /**
   * 标准化模块调用接口
   * @param {string} route - 路由名称
   * @param {Object} req - Express请求对象
   * @returns {Object} 标准化响应
   */
  async callModule(route, req) {
    // 合并查询参数 - 在平台层统一处理
    const query = { ...req.query, ...req.body }

    try {
      // 验证初始化状态
      if (!this.initialized) {
        throw new Error(`Platform ${this.name} is not initialized`)
      }

      // 获取模块函数
      const moduleFunction = this.modules.get(route)
      if (!moduleFunction) {
        throw new Error(`Module ${route} not found in platform ${this.name}`)
      }

      // 验证平台名 - 确保请求是给当前平台的
      const requestedPlatform = query.platform || 'netease'
      if (requestedPlatform !== this.name) {
        throw new Error(`Platform mismatch: requested ${requestedPlatform}, but called ${this.name}`)
      }

      // 优化: 先检查缓存,命中则直接返回,避免不必要的参数验证
      let cachedResult = null
      if (this.cacheEnabled) {
        // 获取路由特定的TTL配置
        const cacheConfigs = PlatformConfig.getCacheConfigs(this.name)
        const routeConfig = cacheConfigs[route]
        if (this._isRouteCacheEnabled(routeConfig, query)) {
          cachedResult = this.cache.get(this.name, route, query)
        }
      }

      // 缓存命中,直接返回(跳过参数验证,节省1-3ms)
      if (cachedResult) {
        return Result.success(cachedResult)
      }

      // 缓存未命中,执行参数验证
      const validation = this.validateQuery(query, route)
      if (!validation.valid) {
        const message = Array.isArray(validation.errors)
          ? validation.errors.join('; ')
          : validation.errors
        throw new Error(`Validation failed: ${message}`)
      }

      // 平台特定的前置验证（子类可重写）
      // await this.beforeModuleCall(query, route)

      // 使用并发限流器执行模块 - 防止系统过载
      const result = await globalLimiter.execute(async () => {
        return await moduleFunction(
          query,
          this.createRequestFunction()
        )
      })

      // 缓存结果
      if (this.cacheEnabled) {
        const cacheConfigs = PlatformConfig.getCacheConfigs(this.name)
        const routeConfig = cacheConfigs[route]
        if (this._isRouteCacheEnabled(routeConfig, query)) {
          const ttl = this._resolveTTL(routeConfig, query)
          this.cache.set(this.name, route, query, result, ttl)
        }
      }

      return Result.success(result)

    } catch (error) {
      const statusCode = 500

      return Result.error(error, statusCode)
    }
  }


  /**
   * 解析TTL配置，支持分钟和毫秒两种单位
   * @param {Object} routeConfig - 路由缓存配置
   * @param {Object} query - 查询参数
   * @returns {number} TTL毫秒数
   */
  _resolveTTL(routeConfig, query = {}) {
    // 日更数据缓存到当前运行环境本地时区的下一个 0 点
    if (routeConfig.ttlUntilMidnight || this._shouldUseMidnightTTL(routeConfig, query)) {
      return this._millisecondsUntilNextLocalMidnight()
    }

    // 优先使用 ttlMinutes（分钟），如果存在则转换为毫秒
    if (routeConfig.ttlMinutes !== undefined) {
      return routeConfig.ttlMinutes * 60 * 1000
    }

    // 其次使用 ttl（毫秒），向后兼容
    if (routeConfig.ttl !== undefined) {
      return routeConfig.ttl
    }

    // 最后使用平台默认TTL
    return this.defaultTTL
  }

  /**
   * 计算距离下一个本地 0 点的毫秒数。
   */
  _millisecondsUntilNextLocalMidnight(now = new Date()) {
    const nextMidnight = new Date(now)
    nextMidnight.setHours(24, 0, 0, 0)
    return Math.max(1, nextMidnight.getTime() - now.getTime())
  }

  _shouldUseMidnightTTL(routeConfig, query) {
    if (!Array.isArray(routeConfig.ttlUntilMidnightParams)) {
      return false
    }
    return routeConfig.ttlUntilMidnightParams.some(param => {
      const value = query[param]
      return value !== undefined && value !== null && String(value).trim() !== ''
    })
  }

  _isRouteCacheEnabled(routeConfig, query) {
    if (!routeConfig || routeConfig.enabled === false) {
      return false
    }
    if (!Array.isArray(routeConfig.enabledWhenParams)) {
      return true
    }
    return routeConfig.enabledWhenParams.some(param => {
      const value = query[param]
      return value !== undefined && value !== null && String(value).trim() !== ''
    })
  }

  /**
   * 模块调用前
   * @param {Object} query - 查询参数
   * @param {string} route - 路由名称
   */
  async beforeModuleCall(query, route) {
    // 默认空实现，子类可以重写此方法进行自定义验证
  }

  /**
   * 加载平台API模块（异步批量加载）
   */
  async loadModules(modulePath) {
    const fs = require('fs').promises
    const path = require('path')

    try {
      await fs.access(modulePath)
    } catch {
      this.logger.warn('Module directory not found', { modulePath })
      return
    }

    const files = await fs.readdir(modulePath)
    const jsFiles = files.filter(file => file.endsWith('.js'))

    // 并发加载所有模块 (Promise.all)
    const loadPromises = jsFiles.map(async file => {
      try {
        const moduleRoute = file.replace(/\.js$/i, '').replace(/_/g, '/')
        const moduleFunction = require(path.join(modulePath, file))
        this.modules.set(moduleRoute, moduleFunction)

        this.logger.compact('module', `Loaded ${moduleRoute}`, 'debug')
        return true
      } catch (error) {
        this.logger.warn(`Failed to load module ${file}`, error)
        return false
      }
    })

    const results = await Promise.all(loadPromises)
    const loadedCount = results.filter(Boolean).length

    this.logger.compact('module', `Loaded ${loadedCount} modules`, 'debug')
  }


  /**
   * 验证查询参数
   * @param {Object} query - 查询参数
   * @param {string} route - 路由名称
   * @returns {Object} 验证结果
   */
  validateQuery(query, route) {
    const errors = []

    // 通用参数验证
    const commonValidation = PlatformConfig.getCommonValidation()

    for (const [paramName, rule] of Object.entries(commonValidation)) {
      if (query[paramName] !== undefined) {
        const paramErrors = PlatformConfig.validateParam(paramName, query[paramName], rule)
        errors.push(...paramErrors)
      }
    }

    // 特定路由参数验证
    const routeValidation = PlatformConfig.getRouteValidation(route, this.name)
    if (routeValidation) {
      for (const [paramName, rule] of Object.entries(routeValidation)) {
        const paramErrors = PlatformConfig.validateParam(paramName, query[paramName], rule)
        errors.push(...paramErrors)
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors
    }
  }

  /**
   * 创建请求函数
   * 子类需要实现具体的请求逻辑
   * @returns {Function} 请求函数
   */
  createRequestFunction() {
    throw new Error('createRequestFunction must be implemented by subclass')
  }

  
}

module.exports = BasePlatform
