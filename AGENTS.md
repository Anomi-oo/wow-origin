
## wow-origin 项目

### 常用命令

```bash
cd wow-origin
npm install          # 安装依赖
npm start            # 启动服务（端口 3000）
npm run dev          # 调试模式（详细日志）
npm test             # 运行所有测试
npm run test:unit    # 仅单元测试
npm run test:integration  # 仅集成测试
npm run test:coverage     # 覆盖率报告
```

### 环境配置

复制 `.env.example` 为 `.env`，关键变量：
- `PORT` — 服务端口（默认 3000）
- `CORS_ALLOW_ORIGIN` — CORS 源（开发用 `*`，生产指定域名）

### 架构要点

- 入口：`src/server.ts`，Express 应用：`src/app.ts`，SDK Adapter 接入：`src/adapter.ts`
- 私有平台实现保留在根目录 `platforms/`，平台客户端位于 `src/clients/`
- 平台适配器模式：`platforms/PlatformFactory.js` 管理 netease 和 qqmusic
- v1 API：`/v1/` 路由由 `aduoer-wow-sdk` 提供，本项目只把私有平台 Adapter 和账号上下文接入 SDK
- 协议、响应 schema 与 OpenAPI 的唯一所有者是公开 `aduoer-wow-sdk`；`openapi.ts` 仅保留兼容导出
- `/v1/status.data.version` 是当前安装的 SDK SemVer，不存在 `apiVersion`
- 测试配置：`jest.config.js`，覆盖率阈值 50%

### 开发规范

- 使用 Typescript，严格类型检查
- 当完成任务后，需要使用 `npm run build` 确保项目编译能够通过
