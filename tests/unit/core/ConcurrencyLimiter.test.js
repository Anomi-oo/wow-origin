/**
 * ConcurrencyLimiter 单元测试
 * 测试并发限流器的功能
 */
const { ConcurrencyLimiter } = require('../../../core/ConcurrencyLimiter')

describe('ConcurrencyLimiter', () => {
  let limiter

  beforeEach(() => {
    // 创建限流器实例，最大并发3个
    limiter = new ConcurrencyLimiter({ maxConcurrent: 3, queueTimeout: 1000 })
  })

  describe('基本功能', () => {
    test('应该能够执行任务', async () => {
      const task = jest.fn(async () => 'result')
      const result = await limiter.execute(task)

      expect(result).toBe('result')
      expect(task).toHaveBeenCalledTimes(1)
    })

    test('任务抛出错误应该正确传播', async () => {
      const error = new Error('Task failed')
      const task = jest.fn(async () => {
        throw error
      })

      await expect(limiter.execute(task)).rejects.toThrow('Task failed')
    })
  })

  describe('并发控制', () => {
    test('不超过maxConcurrent时应该立即执行', async () => {
      const delays = [100, 100, 100]
      const tasks = delays.map(delay => async () => {
        await sleep(delay)
        return delay
      })

      const startTime = Date.now()
      const promises = tasks.map(task => limiter.execute(task))
      await Promise.all(promises)
      const duration = Date.now() - startTime

      // 3个任务并发执行，总时间约等于单个任务时间
      expect(duration).toBeLessThan(150)
      expect(limiter.getStatus().activeCount).toBe(0)
    })

    test('超过maxConcurrent时应该排队', async () => {
      const taskDuration = 100
      const tasks = Array(5).fill(null).map(() => async () => {
        await sleep(taskDuration)
        return 'done'
      })

      const startTime = Date.now()
      const promises = tasks.map(task => limiter.execute(task))
      await Promise.all(promises)
      const duration = Date.now() - startTime

      // 5个任务，最大并发3，需要两轮执行
      // 第一轮：3个任务并发（100ms）
      // 第二轮：2个任务并发（100ms）
      // 总时间约200ms
      expect(duration).toBeGreaterThanOrEqual(180)
      expect(duration).toBeLessThan(250)
    })

    test('应该正确更新活跃计数', async () => {
      const task1 = async () => {
        await sleep(100)
        return '1'
      }

      const promise1 = limiter.execute(task1)
      const promise2 = limiter.execute(task1)

      // 任务执行中
      expect(limiter.getStatus().activeCount).toBe(2)

      await Promise.all([promise1, promise2])

      // 任务完成后
      expect(limiter.getStatus().activeCount).toBe(0)
    })
  })

  describe('队列管理', () => {
    test('队列长度应该正确统计', async () => {
      // 启动3个长时间任务（占满并发槽）
      const longTask = async () => await sleep(200)
      limiter.execute(longTask)
      limiter.execute(longTask)
      limiter.execute(longTask)

      // 再添加2个任务，应该进入队列
      const promise4 = limiter.execute(longTask)
      const promise5 = limiter.execute(longTask)

      // 稍等一下确保任务已提交
      await sleep(10)

      const status = limiter.getStatus()
      expect(status.activeCount).toBe(3)
      expect(status.queueLength).toBe(2)
      expect(status.availableSlots).toBe(0)

      await Promise.all([promise4, promise5])
    })

    test('队列超时应该拒绝任务', async () => {
      const shortTimeout = new ConcurrencyLimiter({
        maxConcurrent: 1,
        queueTimeout: 100
      })

      // 第一个任务占用槽位
      const longTask = async () => await sleep(500)
      shortTimeout.execute(longTask)

      // 第二个任务进入队列，但会超时
      await expect(
        shortTimeout.execute(async () => 'result')
      ).rejects.toThrow(/timeout/)
    })
  })

  describe('统计信息', () => {
    test('应该统计总处理数', async () => {
      const task = async () => 'done'

      await limiter.execute(task)
      await limiter.execute(task)
      await limiter.execute(task)

      const stats = limiter.getStatus().stats
      expect(stats.totalProcessed).toBe(3)
    })

    test('应该统计峰值并发', async () => {
      const tasks = Array(5).fill(null).map(() => async () => {
        await sleep(50)
        return 'done'
      })

      const promises = tasks.map(task => limiter.execute(task))
      await sleep(10) // 等待任务开始执行

      const stats = limiter.getStatus().stats
      expect(stats.peakConcurrent).toBe(3) // maxConcurrent = 3

      await Promise.all(promises)
    })

    test('应该统计队列峰值', async () => {
      // 占满并发槽
      const longTask = async () => await sleep(200)
      limiter.execute(longTask)
      limiter.execute(longTask)
      limiter.execute(longTask)

      // 添加多个任务到队列
      const promises = Array(5).fill(null).map(() => limiter.execute(longTask))
      await sleep(10)

      const stats = limiter.getStatus().stats
      expect(stats.peakQueueLength).toBe(5)

      await Promise.all(promises)
    })

    test('应该统计拒绝数', async () => {
      const shortTimeout = new ConcurrencyLimiter({
        maxConcurrent: 1,
        queueTimeout: 50
      })

      shortTimeout.execute(async () => await sleep(200))

      // 这些任务会超时被拒绝
      try {
        await shortTimeout.execute(async () => 'task1')
      } catch (e) {
        // 预期错误
      }

      try {
        await shortTimeout.execute(async () => 'task2')
      } catch (e) {
        // 预期错误
      }

      const stats = shortTimeout.getStatus().stats
      expect(stats.totalRejected).toBeGreaterThanOrEqual(2)
    })

    test('resetStats应该清零统计', async () => {
      await limiter.execute(async () => 'task1')
      await limiter.execute(async () => 'task2')

      limiter.resetStats()

      const stats = limiter.getStatus().stats
      expect(stats.totalProcessed).toBe(0)
      expect(stats.peakConcurrent).toBe(0)
    })
  })

  describe('边界情况', () => {
    test('maxConcurrent=1时应该串行执行', async () => {
      const serial = new ConcurrencyLimiter({ maxConcurrent: 1 })
      const results = []

      const task1 = async () => {
        await sleep(50)
        results.push(1)
        return 1
      }

      const task2 = async () => {
        await sleep(50)
        results.push(2)
        return 2
      }

      await Promise.all([
        serial.execute(task1),
        serial.execute(task2)
      ])

      // 串行执行，顺序应该保持
      expect(results).toEqual([1, 2])
    })

    test('大量并发任务应该正确处理', async () => {
      const tasks = Array(100).fill(null).map((_, i) => async () => {
        await sleep(10)
        return i
      })

      const results = await Promise.all(
        tasks.map(task => limiter.execute(task))
      )

      expect(results).toHaveLength(100)
      expect(limiter.getStatus().activeCount).toBe(0)
    })
  })
})

// 辅助函数：延迟执行
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
