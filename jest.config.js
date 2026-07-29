/**
 * Jest 测试配置
 */
module.exports = {
  // 测试环境
  testEnvironment: 'node',

  // 测试文件匹配模式
  testMatch: [
    '**/tests/**/*.test.ts',
    '**/tests/**/*.test.js',
    '**/tests/**/*.spec.ts',
    '**/tests/**/*.spec.js'
  ],

  // 转换配置
  transform: {
    '^.+\\.ts$': 'ts-jest',
    '^.+\\.js$': 'babel-jest'
  },

  // 模块文件扩展名
  moduleFileExtensions: ['ts', 'js', 'json', 'node'],

  // JavaScript 平台模块仍保留在项目根目录
  moduleNameMapper: {
    '^\\.\\./core/(.*)$': '<rootDir>/core/$1',
    '^\\.\\./platforms/(.*)$': '<rootDir>/platforms/$1'
  },

  // 覆盖率收集配置
  collectCoverageFrom: [
    'core/**/*.js',
    'platforms/**/*.js',
    'src/**/*.ts',
    '!**/node_modules/**',
    '!**/tests/**',
    '!**/module/**' // 排除平台模块（太多且主要是API调用）
  ],

  // 覆盖率阈值（逐步提高）
  coverageThreshold: {
    global: {
      branches: 50,
      functions: 50,
      lines: 50,
      statements: 50
    }
  },

  // 覆盖率报告格式
  coverageReporters: [
    'text',
    'text-summary',
    'html',
    'lcov'
  ],

  // 测试超时时间（API测试可能较慢）
  testTimeout: 10000,

  // 清除模拟
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true,

  // 详细输出
  verbose: true,

  // 忽略的路径
  testPathIgnorePatterns: [
    '/node_modules/',
    '/docs/',
    '/tests/integration/'
  ],

  // 设置文件（在所有测试前运行）
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js']
}
