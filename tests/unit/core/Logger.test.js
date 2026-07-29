/**
 * Logger 单元测试
 * 测试日志系统的核心功能
 */
const Logger = require('../../../core/Logger')
const { globalLogBuffer } = require('../../../core/AsyncLogBuffer')

// Mock console.log 避免测试时输出
let consoleOutput = []
const originalLog = console.log
const originalStdoutWrite = process.stdout.write

beforeAll(() => {
  console.log = (...args) => {
    consoleOutput.push(args.join(' '))
  }
  process.stdout.write = (chunk, encoding, callback) => {
    consoleOutput.push(String(chunk))
    if (typeof encoding === 'function') {
      encoding()
    } else if (typeof callback === 'function') {
      callback()
    }
    return true
  }
})

afterAll(() => {
  console.log = originalLog
  process.stdout.write = originalStdoutWrite
})

beforeEach(() => {
  consoleOutput = []
})

describe('Logger', () => {
  let logger

  beforeEach(() => {
    logger = new Logger({ platform: 'test', component: 'unit-test' })
  })

  describe('基本功能', () => {
    test('应该正确初始化Logger', () => {
      expect(logger.context).toEqual({ platform: 'test', component: 'unit-test' })
      expect(logger.logLevel).toBe('error') // 测试环境默认为error
    })

    test('应该支持info日志', async () => {
      const infoLogger = new Logger({ platform: 'test' })
      infoLogger.logLevel = 'info'
      infoLogger.info('Test info message')
      await globalLogBuffer.flush()
      expect(consoleOutput.length).toBeGreaterThan(0)
    })

    test('应该支持warn日志', async () => {
      const warnLogger = new Logger({ platform: 'test' })
      warnLogger.logLevel = 'warn'
      warnLogger.warn('Test warning')
      await globalLogBuffer.flush()
      expect(consoleOutput.length).toBeGreaterThan(0)
    })

    test('应该支持error日志', () => {
      const error = new Error('Test error')
      logger.error('Error occurred', error)
      expect(consoleOutput.length).toBeGreaterThan(0)
    })

    test('应该支持debug日志', () => {
      const debugLogger = new Logger({ platform: 'test' })
      debugLogger.logLevel = 'debug'
      debugLogger.debug('Debug message')
      expect(consoleOutput.length).toBeGreaterThan(0)
    })
  })

  describe('敏感信息脱敏', () => {
    test('应该脱敏MUSIC_U参数', () => {
      const data = {
        MUSIC_U: 'very_long_secret_cookie_value_12345'
      }
      const masked = logger.maskSensitiveData(data)

      expect(masked.MUSIC_U).not.toBe(data.MUSIC_U)
      expect(masked.MUSIC_U).toContain('***')
    })

    test('应该脱敏uin参数', () => {
      const data = {
        uin: '123456789'
      }
      const masked = logger.maskSensitiveData(data)

      expect(masked.uin).toContain('***')
    })

    test('应该脱敏qm_keyst参数', () => {
      const data = {
        qm_keyst: 'secret_key_value'
      }
      const masked = logger.maskSensitiveData(data)

      expect(masked.qm_keyst).toContain('***')
    })

    test('应该处理短字符串', () => {
      const data = {
        token: 'short'
      }
      const masked = logger.maskSensitiveData(data)

      expect(masked.token).toBe('***')
    })

    test('应该递归脱敏嵌套对象', () => {
      const data = {
        user: {
          MUSIC_U: 'secret_cookie',
          name: 'test'
        }
      }
      const masked = logger.maskSensitiveData(data)

      expect(masked.user.MUSIC_U).toContain('***')
      expect(masked.user.name).toBe('test')
    })

    test('应该处理数组', () => {
      const data = {
        cookies: ['MUSIC_U=secret1', 'MUSIC_U=secret2']
      }
      const masked = logger.maskSensitiveData(data)

      expect(Array.isArray(masked.cookies)).toBe(true)
    })

    test('应该处理非对象值', () => {
      expect(logger.maskSensitiveData(null)).toBeNull()
      expect(logger.maskSensitiveData('string')).toBe('string')
      expect(logger.maskSensitiveData(123)).toBe(123)
    })
  })

  describe('日志级别控制', () => {
    test('error级别应该只记录error日志', () => {
      logger.logLevel = 'error'

      expect(logger.shouldLog('debug')).toBe(false)
      expect(logger.shouldLog('info')).toBe(false)
      expect(logger.shouldLog('warn')).toBe(false)
      expect(logger.shouldLog('error')).toBe(true)
    })

    test('warn级别应该记录warn和error', () => {
      logger.logLevel = 'warn'

      expect(logger.shouldLog('debug')).toBe(false)
      expect(logger.shouldLog('info')).toBe(false)
      expect(logger.shouldLog('warn')).toBe(true)
      expect(logger.shouldLog('error')).toBe(true)
    })

    test('info级别应该记录info、warn和error', () => {
      logger.logLevel = 'info'

      expect(logger.shouldLog('debug')).toBe(false)
      expect(logger.shouldLog('info')).toBe(true)
      expect(logger.shouldLog('warn')).toBe(true)
      expect(logger.shouldLog('error')).toBe(true)
    })

    test('debug级别应该记录所有日志', () => {
      logger.logLevel = 'debug'

      expect(logger.shouldLog('debug')).toBe(true)
      expect(logger.shouldLog('info')).toBe(true)
      expect(logger.shouldLog('warn')).toBe(true)
      expect(logger.shouldLog('error')).toBe(true)
    })
  })

  describe('错误序列化', () => {
    test('应该序列化Error对象', () => {
      const error = new Error('Test error')
      const serialized = logger.serializeError(error)

      expect(serialized).toHaveProperty('name', 'Error')
      expect(serialized).toHaveProperty('message', 'Test error')
      expect(serialized).toHaveProperty('stack')
      expect(serialized.stack).toBeTruthy()
    })

    test('应该处理带code的错误', () => {
      const error = new Error('Test error')
      error.code = 'ENOENT'
      const serialized = logger.serializeError(error)

      expect(serialized.code).toBe('ENOENT')
    })

    test('应该处理null', () => {
      expect(logger.serializeError(null)).toBeNull()
    })

    test('应该限制堆栈长度', () => {
      const error = new Error('Test error')
      // 创建很长的堆栈
      error.stack = Array(100).fill('at line').join('\n')

      const serialized = logger.serializeError(error)
      const stackLines = serialized.stack.split('\n')

      expect(stackLines.length).toBeLessThanOrEqual(5)
    })
  })

  describe('JSON格式化', () => {
    test('应该格式化对象为JSON', () => {
      const obj = { key: 'value', number: 123 }
      const formatted = logger.formatJSON(obj)

      expect(formatted).toContain('key')
      expect(formatted).toContain('value')
      expect(formatted).toContain('123')
    })

    test('应该截断过长的字符串', () => {
      const obj = {
        longString: 'x'.repeat(1000)
      }
      const formatted = logger.formatJSON(obj)

      expect(formatted).toContain('...')
    })

    test('应该处理格式化错误', () => {
      const circular = {}
      circular.self = circular

      const formatted = logger.formatJSON(circular)
      expect(formatted).toBeDefined()
    })
  })

  describe('辅助方法', () => {
    test('getShortTime应该返回时间字符串', () => {
      const time = logger.getShortTime()
      expect(time).toMatch(/\d{2}:\d{2}:\d{2}/)
    })

    test('getLevelColor应该返回颜色代码', () => {
      expect(logger.getLevelColor('info')).toBe(logger.colors.green)
      expect(logger.getLevelColor('warn')).toBe(logger.colors.yellow)
      expect(logger.getLevelColor('error')).toBe(logger.colors.red)
      expect(logger.getLevelColor('debug')).toBe(logger.colors.gray)
    })

    test('getLevelIcon应该返回图标', () => {
      expect(logger.getLevelIcon('info')).toBe(logger.icons.info)
      expect(logger.getLevelIcon('warn')).toBe(logger.icons.warning)
      expect(logger.getLevelIcon('error')).toBe(logger.icons.error)
      expect(logger.getLevelIcon('debug')).toBe(logger.icons.debug)
    })

    test('formatContextTag应该格式化上下文标签', () => {
      const tag = logger.formatContextTag()
      expect(tag).toContain('test')
      expect(tag).toContain('unit-test')
    })

    test('formatContextTag应该处理空上下文', () => {
      const emptyLogger = new Logger()
      const tag = emptyLogger.formatContextTag()
      expect(tag).toBe('')
    })
  })

  describe('compact日志', () => {
    test('应该输出简洁日志', async () => {
      logger.logLevel = 'info'
      logger.compact('success', 'Operation completed', 'info')
      await globalLogBuffer.flush()

      expect(consoleOutput.length).toBeGreaterThan(0)
      expect(consoleOutput[0]).toContain('Operation completed')
    })

    test('应该使用自定义emoji', async () => {
      logger.logLevel = 'info'
      logger.compact('star', 'Custom emoji', 'info')
      await globalLogBuffer.flush()

      expect(consoleOutput[0]).toContain('Custom emoji')
    })
  })

  describe('detail日志', () => {
    test('应该输出详细日志', () => {
      logger.logLevel = 'info'
      logger.detail('info', 'Detailed message', { key: 'value' })

      expect(consoleOutput.length).toBeGreaterThan(0)
    })

    test('应该处理空数据', () => {
      logger.logLevel = 'info'
      logger.detail('info', 'Message only')

      expect(consoleOutput.length).toBeGreaterThan(0)
    })
  })

  describe('request日志', () => {
    test('应该记录成功的请求', async () => {
      logger.logLevel = 'info'
      logger.request('/test/route', 150, {
        platform: 'netease',
        params: { id: '123', nested: { quality: 'lossless' } },
        ip: '127.0.0.1'
      })

      await globalLogBuffer.flush()
      // request使用异步缓冲,flush后应该有输出
      expect(consoleOutput.length).toBeGreaterThan(0)
      expect(consoleOutput.join('')).toContain('Params: {"id":"123","nested":{"quality":"lossless"}}')
      expect(consoleOutput.join('')).not.toContain('\n  Params:')
    })

    test('应该记录缓存命中', async () => {
      logger.logLevel = 'info'
      logger.request('/test/route', 5, {
        platform: 'netease',
        cached: true
      })

      await globalLogBuffer.flush()
      expect(consoleOutput.length).toBeGreaterThan(0)
    })

    test('应该记录错误请求', async () => {
      logger.logLevel = 'info' // request需要info级别
      logger.request('/test/route', 200, {
        platform: 'netease',
        error: 'Something went wrong',
        params: { key: 'value' }
      })

      // 错误日志使用紧急刷新,应该立即输出
      // 但也等待一下确保异步操作完成
      await new Promise(resolve => setTimeout(resolve, 10))

      // 错误请求应该输出日志
      expect(consoleOutput.length).toBeGreaterThan(0)
    })
  })
})
