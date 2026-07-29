/**
 * Jest 测试环境设置
 * 在所有测试前运行
 */

// 设置测试环境变量
process.env.NODE_ENV = 'test'
process.env.LOG_LEVEL = 'error' // 测试时减少日志输出

// 全局测试超时
jest.setTimeout(10000)

// 全局 beforeAll
beforeAll(() => {
  // 可以在这里初始化全局资源
})

// 全局 afterAll
afterAll(() => {
  // 清理全局资源
})
