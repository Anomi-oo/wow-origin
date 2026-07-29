/**
 * 并发请求限流器
 * 防止大量并发请求导致系统资源耗尽（雪崩效应）
 *
 * 工作原理：
 * 1. 使用信号量机制控制并发数量
 * 2. 超出并发限制的请求进入等待队列
 * 3. 支持超时机制避免请求长时间挂起
 * 4. 提供性能统计（活跃请求数、队列长度等）
 */

class ConcurrencyLimiter {
  constructor(options = {}) {
    this.maxConcurrent = options.maxConcurrent || 300  // 最大并发数 (默认300)
    this.queueTimeout = options.queueTimeout || 2000   // 队列超时时间(ms) (默认2秒)

    this.activeCount = 0      // 当前活跃请求数
    this.waitingQueue = []    // 等待队列

    // 统计信息
    this.stats = {
      totalProcessed: 0,      // 总处理数
      totalRejected: 0,       // 总拒绝数（超时）
      totalQueued: 0,         // 总排队数
      peakConcurrent: 0,      // 峰值并发数
      peakQueueLength: 0      // 峰值队列长度
    }
  }

  /**
   * 执行任务（带并发控制）
   * @param {Function} task - 异步任务函数
   * @returns {Promise} 任务结果
   */
  async execute(task) {
    // 检查是否可以立即执行
    if (this.activeCount < this.maxConcurrent) {
      return this._runTask(task)
    }

    // 需要排队等待
    return this._enqueue(task)
  }

  /**
   * 立即执行任务
   * @private
   */
  async _runTask(task) {
    this.activeCount++
    this.stats.totalProcessed++

    // 更新峰值统计
    if (this.activeCount > this.stats.peakConcurrent) {
      this.stats.peakConcurrent = this.activeCount
    }

    try {
      const result = await task()
      return result
    } finally {
      this.activeCount--
      this._processQueue()  // 处理等待队列
    }
  }

  /**
   * 将任务加入等待队列
   * @private
   */
  async _enqueue(task) {
    this.stats.totalQueued++

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        // 超时处理：从队列中移除
        const index = this.waitingQueue.findIndex(item => item.timeoutId === timeoutId)
        if (index !== -1) {
          this.waitingQueue.splice(index, 1)
        }

        this.stats.totalRejected++
        reject(new Error(`Request timeout: exceeded queue wait time (${this.queueTimeout}ms)`))
      }, this.queueTimeout)

      // 加入等待队列
      this.waitingQueue.push({
        task,
        resolve,
        reject,
        timeoutId,
        enqueuedAt: Date.now()
      })

      // 更新峰值队列长度
      if (this.waitingQueue.length > this.stats.peakQueueLength) {
        this.stats.peakQueueLength = this.waitingQueue.length
      }
    })
  }

  /**
   * 处理等待队列（有空位时调用）
   * @private
   */
  _processQueue() {
    if (this.waitingQueue.length === 0) {
      return
    }

    if (this.activeCount < this.maxConcurrent) {
      const item = this.waitingQueue.shift()
      if (item) {
        clearTimeout(item.timeoutId)  // 清除超时定时器

        // 执行任务并传递结果
        this._runTask(item.task)
          .then(item.resolve)
          .catch(item.reject)
      }
    }
  }

  /**
   * 获取当前状态
   */
  getStatus() {
    return {
      activeCount: this.activeCount,
      queueLength: this.waitingQueue.length,
      availableSlots: Math.max(0, this.maxConcurrent - this.activeCount),
      stats: { ...this.stats }
    }
  }

  /**
   * 重置统计信息
   */
  resetStats() {
    this.stats = {
      totalProcessed: 0,
      totalRejected: 0,
      totalQueued: 0,
      peakConcurrent: 0,
      peakQueueLength: 0
    }
  }
}

// 创建全局限流器实例
const globalLimiter = new ConcurrencyLimiter({
  maxConcurrent: 300,   // 最大并发300个请求 
  queueTimeout: 2000    // 队列等待超时2秒 
})

module.exports = {
  ConcurrencyLimiter,
  globalLimiter
}
