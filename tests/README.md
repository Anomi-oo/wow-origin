# 测试指南

本项目使用 Jest 作为测试框架，包含单元测试和集成测试。

## 快速开始

```bash
# 安装依赖
npm install

# 运行所有测试
npm test

# 运行测试并生成覆盖率报告
npm run test:coverage

# 监听模式运行测试（开发时使用）
npm run test:watch

# 只运行单元测试
npm run test:unit

# 只运行集成测试
npm run test:integration
```

## 测试结构

```
tests/
├── unit/              # 单元测试
│   ├── core/         # 核心模块测试
│   └── platforms/    # 平台测试
├── integration/      # 集成测试
├── fixtures/         # 测试数据
└── setup.js          # 测试环境设置
```

## 单元测试

### 核心模块测试

- **PlatformCache.test.js**: 测试LRU缓存功能
  - 基本的get/set操作
  - LRU淘汰策略
  - TTL过期机制
  - 缓存管理功能

- **ConcurrencyLimiter.test.js**: 测试并发限流器
  - 基本任务执行
  - 并发控制
  - 队列管理
  - 统计信息

- **Result.test.js**: 测试结果格式化
  - 成功响应格式
  - 错误响应格式
  - 网易云API兼容性

### 平台测试

- **BasePlatform.test.js**: 测试平台基类
  - 平台初始化
  - 模块调用
  - 缓存功能
  - 参数验证

## 集成测试

- **api.test.js**: 测试HTTP端点
  - 状态接口
  - 搜索接口
  - 错误处理
  - CORS支持
  - Cookie处理
  - 缓存行为
  - 并发控制

## 编写新测试

### 单元测试示例

```javascript
describe('MyModule', () => {
  test('should do something', () => {
    const result = myFunction()
    expect(result).toBe(expected)
  })
})
```

### 集成测试示例

```javascript
const request = require('supertest')
const { MultiPlatformServer } = require('../../server')

describe('My API', () => {
  let app

  beforeAll(async () => {
    const server = new MultiPlatformServer()
    app = await server.initialize()
  })

  test('GET /endpoint', async () => {
    const response = await request(app)
      .get('/endpoint')
      .expect(200)

    expect(response.body).toHaveProperty('code', 200)
  })
})
```

## 覆盖率目标

当前覆盖率阈值（逐步提高）：
- 分支覆盖率: 50%
- 函数覆盖率: 50%
- 行覆盖率: 50%
- 语句覆盖率: 50%

查看覆盖率报告：
```bash
npm run test:coverage
# 打开 coverage/lcov-report/index.html 查看详细报告
```

## 注意事项

1. **集成测试**: 需要网络连接，因为会调用真实的音乐API
2. **超时时间**: 集成测试的超时时间设置为10秒
3. **测试环境**: 测试时LOG_LEVEL自动设置为'error'，减少日志输出
4. **模拟**: 使用Jest的mock功能模拟外部依赖

## 持续集成

建议在CI/CD流程中运行测试：

```yaml
# .github/workflows/test.yml 示例
name: Test
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
        with:
          node-version: '18'
      - run: npm install
      - run: npm run test:coverage
```

## 调试测试

使用VSCode调试器：

```json
// .vscode/launch.json
{
  "type": "node",
  "request": "launch",
  "name": "Jest Debug",
  "program": "${workspaceFolder}/node_modules/.bin/jest",
  "args": ["--runInBand"],
  "console": "integratedTerminal",
  "internalConsoleOptions": "neverOpen"
}
```
