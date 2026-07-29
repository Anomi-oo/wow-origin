/**
 * AsyncLogBuffer 单元测试
 * 测试异步日志缓冲器
 */
const { AsyncLogBuffer } = require('../../../core/AsyncLogBuffer')

// Mock process.stdout.write
let stdoutOutput = []
const originalWrite = process.stdout.write

beforeAll(() => {
  process.stdout.write = (data) => {
    stdoutOutput.push(data)
    return true
  }
})

afterAll(() => {
  process.stdout.write = originalWrite
})

beforeEach(() => {
  stdoutOutput = []
})

describe('AsyncLogBuffer', () => {
  let buffer

  afterEach(() => {
    if (buffer) {
      buffer.stop()
    }
  })

  describe('基本功能', () => {
    test('应该正确初始化', () => {
      buffer = new AsyncLogBuffer()

      expect(buffer.buffer).toEqual([])
      expect(buffer.flushInterval).toBe(100)
      expect(buffer.maxBufferSize).toBe(100)
      expect(buffer.enabled).toBe(true)
    })

    test('应该接受自定义配置', () => {
      buffer = new AsyncLogBuffer({
        flushInterval: 200,
        maxBufferSize: 50,
        enabled: false
      })

      expect(buffer.flushInterval).toBe(200)
      expect(buffer.maxBufferSize).toBe(50)
      expect(buffer.enabled).toBe(false)
    })

    test('应该添加日志到缓冲区', () => {
      buffer = new AsyncLogBuffer({ enabled: true })
      buffer.log('Test message')

      expect(buffer.buffer.length).toBe(1)
      expect(buffer.buffer[0]).toBe('Test message')
    })

    test('禁用时应该直接输出', () => {
      const consoleLog = jest.spyOn(console, 'log').mockImplementation()
      buffer = new AsyncLogBuffer({ enabled: false })

      buffer.log('Direct message')

      expect(consoleLog).toHaveBeenCalledWith('Direct message')
      expect(buffer.buffer.length).toBe(0)

      consoleLog.mockRestore()
    })
  })

  describe('刷新机制', () => {
    test('应该在定时器触发时刷新', (done) => {
      buffer = new AsyncLogBuffer({ flushInterval: 50, enabled: true })

      buffer.log('Message 1')
      buffer.log('Message 2')

      expect(buffer.buffer.length).toBe(2)

      setTimeout(() => {
        // 定时器应该已触发刷新
        expect(buffer.buffer.length).toBe(0)
        expect(stdoutOutput.length).toBeGreaterThan(0)
        done()
      }, 100)
    })

    test('应该在缓冲区满时立即刷新', () => {
      buffer = new AsyncLogBuffer({ maxBufferSize: 3, enabled: true })

      buffer.log('Message 1')
      buffer.log('Message 2')
      buffer.log('Message 3') // 触发刷新

      expect(buffer.buffer.length).toBe(0)
      expect(stdoutOutput.length).toBeGreaterThan(0)
    })

    test('紧急消息应该立即刷新', () => {
      buffer = new AsyncLogBuffer({ enabled: true })

      buffer.log('Normal message', false)
      expect(buffer.buffer.length).toBe(1)

      buffer.log('Urgent message', true)
      expect(buffer.buffer.length).toBe(0)
      expect(stdoutOutput.length).toBeGreaterThan(0)
    })

    test('手动flush应该清空缓冲区', () => {
      buffer = new AsyncLogBuffer({ enabled: true })

      buffer.log('Message 1')
      buffer.log('Message 2')
      expect(buffer.buffer.length).toBe(2)

      buffer.flush()

      expect(buffer.buffer.length).toBe(0)
      expect(stdoutOutput.length).toBeGreaterThan(0)
    })

    test('flush空缓冲区应该不报错', () => {
      buffer = new AsyncLogBuffer({ enabled: true })

      expect(() => buffer.flush()).not.toThrow()
      expect(stdoutOutput.length).toBe(0)
    })

    test('应该清除定时器', () => {
      buffer = new AsyncLogBuffer({ flushInterval: 100, enabled: true })

      buffer.log('Message')
      expect(buffer.timer).toBeTruthy()

      buffer.flush()
      expect(buffer.timer).toBeNull()
    })
  })

  describe('批量输出', () => {
    test('应该批量输出多条消息', () => {
      buffer = new AsyncLogBuffer({ enabled: true })

      buffer.log('Line 1')
      buffer.log('Line 2')
      buffer.log('Line 3')

      buffer.flush()

      expect(stdoutOutput.length).toBeGreaterThan(0)
      const output = stdoutOutput.join('')
      expect(output).toContain('Line 1')
      expect(output).toContain('Line 2')
      expect(output).toContain('Line 3')
    })

    test('应该用换行符分隔消息', () => {
      buffer = new AsyncLogBuffer({ enabled: true })

      buffer.log('Message 1')
      buffer.log('Message 2')
      buffer.flush()

      const output = stdoutOutput.join('')
      expect(output).toMatch(/Message 1\nMessage 2\n/)
    })
  })

  describe('启用和停止', () => {
    test('start应该启用缓冲', () => {
      buffer = new AsyncLogBuffer({ enabled: false })
      expect(buffer.enabled).toBe(false)

      buffer.start()
      expect(buffer.enabled).toBe(true)
    })

    test('stop应该禁用缓冲并刷新', () => {
      buffer = new AsyncLogBuffer({ enabled: true })

      buffer.log('Message before stop')
      expect(buffer.buffer.length).toBe(1)

      buffer.stop()

      expect(buffer.enabled).toBe(false)
      expect(buffer.buffer.length).toBe(0)
      expect(stdoutOutput.length).toBeGreaterThan(0)
    })
  })

  describe('边界情况', () => {
    test('应该处理空字符串消息', () => {
      buffer = new AsyncLogBuffer({ enabled: true })

      buffer.log('')
      buffer.flush()

      expect(stdoutOutput.length).toBeGreaterThan(0)
    })

    test('应该处理长消息', () => {
      buffer = new AsyncLogBuffer({ enabled: true })

      const longMessage = 'x'.repeat(10000)
      buffer.log(longMessage)
      buffer.flush()

      expect(stdoutOutput.length).toBeGreaterThan(0)
    })

    test('maxBufferSize=1时应该立即刷新', () => {
      buffer = new AsyncLogBuffer({ maxBufferSize: 1, enabled: true })

      buffer.log('Message')

      expect(buffer.buffer.length).toBe(0)
      expect(stdoutOutput.length).toBeGreaterThan(0)
    })

    test('应该处理快速连续的消息', () => {
      buffer = new AsyncLogBuffer({ enabled: true, maxBufferSize: 1000 })

      for (let i = 0; i < 100; i++) {
        buffer.log(`Message ${i}`)
      }

      expect(buffer.buffer.length).toBeLessThanOrEqual(100)
    })
  })

  describe('定时器管理', () => {
    test('应该在flush后清除定时器', (done) => {
      buffer = new AsyncLogBuffer({ flushInterval: 1000, enabled: true })

      buffer.log('Message')
      const timerId = buffer.timer

      buffer.flush()

      expect(buffer.timer).toBeNull()

      // 确保旧定时器不会触发
      setTimeout(() => {
        const bufferLength = buffer.buffer.length
        buffer.log('New message')
        expect(buffer.buffer.length).toBe(bufferLength + 1)
        done()
      }, 50)
    })

    test('多次log应该只创建一个定时器', () => {
      buffer = new AsyncLogBuffer({ flushInterval: 100, enabled: true })

      buffer.log('Message 1')
      const timerId1 = buffer.timer

      buffer.log('Message 2')
      const timerId2 = buffer.timer

      expect(timerId1).toBe(timerId2)
    })
  })
})
