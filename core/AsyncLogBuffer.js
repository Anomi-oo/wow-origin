/**
 * 异步日志缓冲器
 * 将日志写入操作从事件循环中分离，减少I/O阻塞
 *
 * 工作原理:
 * 1. 日志消息先进入内存队列（非阻塞）
 * 2. 定时批量刷新到stdout（减少系统调用）
 * 3. 支持紧急刷新（错误日志立即输出）
 */

class AsyncLogBuffer {
  constructor(options = {}) {
    this.buffer = []
    this.flushInterval = options.flushInterval || 100  // 刷新间隔(ms)
    this.maxBufferSize = options.maxBufferSize || 100  // 最大缓冲数量
    this.timer = null
    this.enabled = options.enabled !== false
  }

  /**
   * 添加日志到缓冲区
   * @param {string} message - 日志消息
   * @param {boolean} urgent - 是否紧急（立即刷新）
   */
  log(message, urgent = false) {
    if (!this.enabled) {
      // 异步日志禁用时，直接输出
      console.log(message)
      return
    }

    this.buffer.push(message)

    // 紧急消息或缓冲区满时立即刷新
    if (urgent || this.buffer.length >= this.maxBufferSize) {
      this.flush()
      return
    }

    // 启动定时刷新
    if (!this.timer) {
      this.timer = setTimeout(() => {
        this.flush()
      }, this.flushInterval)
    }
  }

  /**
   * 刷新缓冲区到stdout
   */
  flush() {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }

    if (this.buffer.length === 0) {
      return
    }

    // 批量输出（减少系统调用次数）
    const messages = this.buffer.splice(0, this.buffer.length)
    process.stdout.write(messages.join('\n') + '\n')
  }

  /**
   * 启动自动刷新
   */
  start() {
    this.enabled = true
  }

  /**
   * 停止自动刷新并清空缓冲区
   */
  stop() {
    this.enabled = false
    this.flush()
  }
}

// 创建全局日志缓冲器实例
const globalLogBuffer = new AsyncLogBuffer({
  flushInterval: 100,   // 每100ms刷新一次
  maxBufferSize: 100,   // 最多缓冲100条
  enabled: true         // 默认启用
})

// 进程退出时刷新缓冲区
process.on('exit', () => {
  globalLogBuffer.flush()
})

process.on('SIGINT', () => {
  globalLogBuffer.flush()
  process.exit(0)
})

process.on('SIGTERM', () => {
  globalLogBuffer.flush()
  process.exit(0)
})

module.exports = {
  AsyncLogBuffer,
  globalLogBuffer
}
