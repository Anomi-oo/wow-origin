/**
 * 优化的日志系统
 * - 简洁单行输出(常规操作)
 * - 详细JSON输出(错误和复杂数据)
 * - Emoji图标系统(快速识别)
 * - 智能格式化(自动判断输出方式)
 * - 异步日志缓冲(减少I/O阻塞)
 */

const { globalLogBuffer } = require('./AsyncLogBuffer')

class Logger {
  constructor(context = {}) {
    this.context = context
    this.logLevel = process.env.LOG_LEVEL || 'info'

    // 敏感参数配置
    this.sensitiveKeys = [
      'MUSIC_U',      // 网易云Cookie
      'uin',          // QQ音乐用户ID
      'qm_keyst',     // QQ音乐Key
      'cookie',       // 通用Cookie
      'token',        // Token
      'password',     // 密码
      'secret',       // 密钥
      'authorization' // 认证头
    ]

    // Emoji图标映射
    this.icons = {
      success: '✅',
      error: '❌',
      warning: '⚠️',
      info: 'ℹ️',
      debug: '🔍',
      request: '🌐',
      cache: '⚡',
      module: '📦',
      platform: '🎵',
      performance: '⏱️',
      user: '👤',
      search: '🔎'
    }

    // 颜色代码
    this.colors = {
      reset: '\x1b[0m',
      bright: '\x1b[1m',
      dim: '\x1b[2m',
      green: '\x1b[32m',
      yellow: '\x1b[33m',
      red: '\x1b[31m',
      gray: '\x1b[90m',
      cyan: '\x1b[36m',
      magenta: '\x1b[35m',
      blue: '\x1b[34m'
    }
  }

  /**
   * 脱敏处理 - 隐藏敏感参数
   * @param {Object} obj - 需要脱敏的对象
   * @returns {Object} 脱敏后的对象
   */
  maskSensitiveData(obj) {
    if (!obj || typeof obj !== 'object') {
      return obj
    }

    const masked = Array.isArray(obj) ? [] : {}

    for (const [key, value] of Object.entries(obj)) {
      const lowerKey = key.toLowerCase()
      const isSensitive = this.sensitiveKeys.some(sensitiveKey =>
        lowerKey.includes(sensitiveKey.toLowerCase())
      )

      if (isSensitive && typeof value === 'string' && value.length > 0) {
        // 敏感信息显示前后各2个字符
        if (value.length <= 8) {
          masked[key] = '***'
        } else {
          const prefix = value.substring(0, 2)
          const suffix = value.substring(value.length - 2)
          masked[key] = `${prefix}***${suffix}`
        }
      } else if (typeof value === 'object' && value !== null) {
        // 递归处理嵌套对象
        masked[key] = this.maskSensitiveData(value)
      } else {
        masked[key] = value
      }
    }

    return masked
  }

  /**
   * HTTP请求日志(简洁格式 + 异步缓冲)
   * @param {string} route - 路由路径
   * @param {number} time - 响应时间(ms)
   * @param {Object} options - 额外选项 {platform, cached, error, params, ip}
   */
  request(route, time, options = {}) {
    if (!this.shouldLog('info')) return

    const timestamp = this.getShortTime()
    const { platform, cached, error, params, ip } = options

    // 构建上下文标签 [platform/component]
    const contextParts = []
    if (platform) contextParts.push(platform)
    if (this.context.platform && !platform) contextParts.push(this.context.platform)
    if (this.context.component) contextParts.push(this.context.component)

    const contextTag = contextParts.length > 0
      ? ` ${this.colors.dim}[${this.colors.cyan}${contextParts.join('/')}${this.colors.dim}]${this.colors.reset}`
      : ''

    // IP标签（如果提供）
    const ipTag = ip
      ? ` ${this.colors.dim}| ${this.colors.magenta}${ip}${this.colors.reset}`
      : ''

    if (error) {
      // 错误请求 - 立即输出（紧急）
      let errorLog = `${timestamp} ${this.icons.error} ${this.colors.red}${route}${this.colors.reset}${contextTag}${ipTag} ${this.colors.dim}| ${time}ms${this.colors.reset}`
      if (params && Object.keys(params).length > 0) {
        const maskedParams = this.maskSensitiveData(params)
        errorLog += ` ${this.colors.dim}|${this.colors.reset} ${this.colors.gray}Params: ${this.formatCompactJSON(maskedParams)}${this.colors.reset}`
      }
      errorLog += `\n${this.colors.red}  Error: ${error}${this.colors.reset}`

      globalLogBuffer.log(errorLog, true)  // 紧急刷新
    } else if (cached) {
      // 缓存命中 - 异步缓冲输出
      const cacheLog = `${timestamp} ${this.icons.success} ${this.colors.green}${route}${this.colors.reset}${contextTag}${ipTag} ${this.colors.dim}| ${time}ms | ${this.icons.cache} CACHE${this.colors.reset}`
      globalLogBuffer.log(cacheLog, false)
    } else {
      // 普通请求 - 异步缓冲输出
      const timeColor = time > 1000 ? this.colors.red : time > 500 ? this.colors.yellow : this.colors.cyan
      let requestLog = `${timestamp} ${this.icons.request} ${this.colors.green}${route}${this.colors.reset}${contextTag}${ipTag} ${this.colors.dim}| ${timeColor}${time}ms${this.colors.reset}`
      if (params && Object.keys(params).length > 0) {
        const maskedParams = this.maskSensitiveData(params)
        requestLog += ` ${this.colors.dim}|${this.colors.reset} ${this.colors.gray}Params: ${this.formatCompactJSON(maskedParams)}${this.colors.reset}`
      }
      globalLogBuffer.log(requestLog, false)
    }
  }

  /**
   * 简洁单行日志
   * @param {string} icon - emoji图标key或直接的emoji
   * @param {string} message - 消息内容
   * @param {string} level - 日志级别
   */
  compact(icon, message, level = 'info') {
    if (!this.shouldLog(level)) return

    const timestamp = this.getShortTime()
    const emoji = this.icons[icon] || icon
    const color = this.getLevelColor(level)

    // 构建上下文标签
    const contextTag = this.formatContextTag()

    console.log(`${timestamp} ${emoji} ${color}${message}${this.colors.reset}${contextTag}`)
  }

  /**
   * 详细JSON日志
   * @param {string} level - 日志级别
   * @param {string} message - 消息内容
   * @param {Object} data - 详细数据
   */
  detail(level, message, data = {}) {
    if (!this.shouldLog(level)) return

    const timestamp = this.getShortTime()
    const color = this.getLevelColor(level)
    const icon = this.getLevelIcon(level)

    // 构建上下文标签
    const contextTag = this.formatContextTag()

    console.log(`${timestamp} ${icon} ${color}${message}${this.colors.reset}${contextTag}`)

    if (data && Object.keys(data).length > 0) {
      const maskedData = this.maskSensitiveData(data)
      console.log(this.formatJSON(maskedData))
    }
  }

  /**
   * 格式化上下文标签
   * @returns {string} 格式化的上下文标签
   */
  formatContextTag() {
    const contextParts = []
    if (this.context.platform) contextParts.push(this.context.platform)
    if (this.context.component) contextParts.push(this.context.component)

    return contextParts.length > 0
      ? ` ${this.colors.dim}[${this.colors.cyan}${contextParts.join('/')}${this.colors.dim}]${this.colors.reset}`
      : ''
  }

  /**
   * 信息日志
   */
  info(message, data = {}) {
    if (typeof message === 'string' && Object.keys(data).length === 0) {
      this.compact('info', message, 'info')
    } else {
      this.detail('info', message, data)
    }
  }

  /**
   * 警告日志
   */
  warn(message, data = {}) {
    if (typeof message === 'string' && Object.keys(data).length === 0) {
      this.compact('warning', message, 'warn')
    } else {
      this.detail('warn', message, data)
    }
  }

  /**
   * 错误日志
   */
  error(message, error = null, data = {}) {
    const errorData = error ? this.serializeError(error) : null
    this.detail('error', message, { ...data, error: errorData })
  }

  /**
   * 调试日志
   */
  debug(message, data = {}) {
    if (typeof message === 'string' && Object.keys(data).length === 0) {
      this.compact('debug', message, 'debug')
    } else {
      this.detail('debug', message, data)
    }
  }

  /**
   * 获取短时间格式 HH:mm:ss
   */
  getShortTime() {
    const now = new Date()
    const hours = String(now.getHours()).padStart(2, '0')
    const minutes = String(now.getMinutes()).padStart(2, '0')
    const seconds = String(now.getSeconds()).padStart(2, '0')
    return `${this.colors.dim}${hours}:${minutes}:${seconds}${this.colors.reset}`
  }

  /**
   * 获取级别对应的颜色
   */
  getLevelColor(level) {
    const colorMap = {
      info: this.colors.green,
      warn: this.colors.yellow,
      error: this.colors.red,
      debug: this.colors.gray
    }
    return colorMap[level] || this.colors.reset
  }

  /**
   * 获取级别对应的图标
   */
  getLevelIcon(level) {
    const iconMap = {
      info: this.icons.info,
      warn: this.icons.warning,
      error: this.icons.error,
      debug: this.icons.debug
    }
    return iconMap[level] || this.icons.info
  }

  /**
   * 格式化JSON输出（美化格式）
   */
  formatJSON(obj) {
    try {
      const jsonStr = JSON.stringify(obj, (_key, value) => {
        // 截断过长的字符串
        if (typeof value === 'string' && value.length > 500) {
          return value.substring(0, 500) + '...'
        }
        return value
      }, 2)

      // 整体添加灰色和缩进（保持JSON结构完整性）
      const indentedJson = jsonStr
        .split('\n')
        .map(line => `  ${line}`)
        .join('\n')

      return `${this.colors.gray}${indentedJson}${this.colors.reset}`
    } catch (e) {
      return `${this.colors.gray}  ${String(obj)}${this.colors.reset}`
    }
  }

  /**
   * 将请求参数序列化为单行 JSON，避免请求日志占用多行。
   */
  formatCompactJSON(obj) {
    try {
      return JSON.stringify(obj, (_key, value) => {
        if (typeof value === 'string' && value.length > 500) {
          return value.substring(0, 500) + '...'
        }
        return value
      })
    } catch (e) {
      return String(obj)
    }
  }

  /**
   * 序列化错误对象
   */
  serializeError(error) {
    if (!error) return null

    return {
      name: error.name,
      message: error.message,
      stack: error.stack?.split('\n').slice(0, 5).join('\n'), // 只保留前5行堆栈
      code: error.code || null,
      details: error.details || null
    }
  }

  /**
   * 判断是否应该记录日志
   */
  shouldLog(level) {
    const levels = ['debug', 'info', 'warn', 'error']
    const currentLevelIndex = levels.indexOf(this.logLevel.toLowerCase())
    const messageLevelIndex = levels.indexOf(level.toLowerCase())

    return messageLevelIndex >= currentLevelIndex
  }
}

module.exports = Logger
