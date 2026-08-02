# Aduoer Wow Origin

本项目基于 [Aduoer-Music/aduoer-wow-template](https://github.com/Aduoer-Music/aduoer-wow-template) 开发。

Aduoer Wow Origin 是一个基于 Node.js 与 TypeScript 的多平台音乐 API 服务，为 Aduoer 客户端提供统一的 Wow v1 接口，并兼容网易云音乐、QQ 音乐的部分上游接口。

项目目前仅支持从本仓库的 `Dockerfile` 本地构建镜像，不依赖任何远程镜像仓库。

## 功能

- 通过统一的 `/v1/*` 接口访问 QQ 音乐和网易云音乐
- 使用 `Authorization` 令牌选择服务端配置的账号，客户端无需传递平台 Cookie
- 支持搜索、歌单、榜单、歌曲、专辑、歌手、歌词和播放地址等能力
- 支持多账号配置、扫码登录和 Cookie 刷新
- 可选接入洛雪自定义源，为 `/v1/track/url` 提供播放地址回退
- 提供缓存、并发限制、结构化错误和自动化测试

## 快速开始

### 环境要求

- Docker 20.10 或更高版本
- Docker Compose v2（使用 Compose 部署时）

### 1. 准备配置

复制环境变量与账号配置示例：

```bash
cp .env.example .env
cp data/accounts.example.json data/accounts.json
```

为每个账号设置唯一且不可猜测的 `api_access_key`。可以使用以下命令生成：

```bash
openssl rand -hex 32
```

`data/accounts.json` 示例：

```json
[
  {
    "platform": "qq",
    "name": "QQ 音乐",
    "cookie": "",
    "api_access_key": "替换为随机生成的访问密钥",
    "stateless": false,
    "needUnlock": true
  },
  {
    "platform": "netease",
    "name": "网易云音乐",
    "cookie": "",
    "api_access_key": "替换为另一个随机访问密钥",
    "stateless": false,
    "needUnlock": true
  }
]
```

字段说明：

| 字段 | 说明 |
| --- | --- |
| `platform` | `qq` 或 `netease` |
| `name` | 账号显示名称 |
| `cookie` | 平台 Cookie；可留空后通过扫码登录写入 |
| `api_access_key` | `/v1/*` 接口的访问令牌，必填且必须唯一 |
| `stateless` | 是否以无状态方式使用账号 |
| `needUnlock` | 是否允许使用洛雪自定义源解析播放地址 |

缺失、为空或重复的 `api_access_key` 会导致对应账号被忽略。`stateless` 和 `needUnlock` 必须使用 JSON 布尔值。

### 2. 使用 Dockerfile 构建并运行

在项目目录执行：

```bash
docker build -t aduoer-wow:local -f Dockerfile .

docker run -d \
  --name aduoer-wow \
  -p 3000:3000 \
  --env-file .env \
  -v "$(pwd)/data:/app/data" \
  --restart unless-stopped \
  aduoer-wow:local
```

查看运行日志：

```bash
docker logs -f aduoer-wow
```

更新代码后，重新构建并替换容器：

```bash
docker stop aduoer-wow
docker rm aduoer-wow
docker build -t aduoer-wow:local -f Dockerfile .
```

然后再次执行上面的 `docker run` 命令。

### 使用 Docker Compose

`docker-compose.yml` 同样通过当前目录的 `Dockerfile` 构建，不会拉取远程项目镜像：

```bash
docker compose up -d --build
```

常用命令：

```bash
docker compose logs -f
docker compose restart
docker compose down
```

服务默认监听 `http://localhost:3000`，账号数据和洛雪源缓存保存在宿主机的 `data/` 目录中。

## API 使用

### Wow v1 API

`/v1/*` 使用 `Authorization` 请求头认证。令牌对应 `data/accounts.json` 中的 `api_access_key`，并由服务端决定使用哪个平台账号。

```bash
# 服务状态和能力
curl -H "Authorization: Bearer your_api_access_key" \
  "http://localhost:3000/v1/status"

# 搜索歌曲
curl -H "Authorization: Bearer your_api_access_key" \
  "http://localhost:3000/v1/search/tracks?keywords=周杰伦&offset=0&limit=20"

# 获取歌单
curl -H "Authorization: Bearer your_api_access_key" \
  "http://localhost:3000/v1/playlist/detail?id=123456789"

# 获取歌曲详情
curl -H "Authorization: Bearer your_api_access_key" \
  "http://localhost:3000/v1/track?id=0039MnYb0qxYhV"

# 获取播放地址，quality 默认为 max
curl -H "Authorization: Bearer your_api_access_key" \
  "http://localhost:3000/v1/track/url?id=0039MnYb0qxYhV&quality=max"

# 获取歌词
curl -H "Authorization: Bearer your_api_access_key" \
  "http://localhost:3000/v1/track/lyrics?id=0039MnYb0qxYhV"
```

成功响应格式为 `{ "code": 200, "data": ... }`；错误响应格式为 `{ "code": <HTTP 状态码>, "message": "...", "data": null }`。认证失败返回 `401`。

播放地址接口支持自动策略 `max`、`min`，以及 `standard`、`higher`、`exhigh`、`lossless`。自动策略会根据平台能力进行降级或升级，指定具体音质时不会自动切换。

### 平台兼容接口

项目还保留部分平台原始接口，通过 `platform=netease` 或 `platform=qqmusic` 选择平台：

```bash
curl "http://localhost:3000/search?keywords=周杰伦&platform=netease"
curl "http://localhost:3000/song/detail?ids=347230&platform=netease"
curl "http://localhost:3000/toplist?platform=qqmusic"
```

此类接口可直接通过 Cookie 或查询参数传递登录信息。新接入建议优先使用 `/v1/*`，避免客户端持有平台 Cookie。

### OpenAPI 文档

开发环境会提供：

```text
http://localhost:3000/openapi.json
```

当 `NODE_ENV=production` 时，该端点不会公开。

## 扫码登录

先在 `data/accounts.json` 中创建账号并设置 `api_access_key`，然后打开：

```text
http://localhost:3000/login?api_access_key=your_api_access_key
```

登录成功后，服务会更新内存中的账号会话，并把 Cookie 写回挂载的 `data/accounts.json`。该文件包含登录凭据，不应提交到 Git、发送给他人或放入公开镜像。

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | 服务端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `NODE_ENV` | `production` | 运行环境 |
| `LOG_LEVEL` | `info` | `debug`、`info`、`warn` 或 `error` |
| `CORS_ALLOW_ORIGIN` | `*` | 允许访问的来源，生产环境建议填写具体域名 |
| `LX_SOURCE_URL` | 空 | 主洛雪自定义源 URL |
| `LX_SOURCE_URL0` 至 `LX_SOURCE_URL9` | 空 | 按编号依次尝试的备用源 URL |

洛雪源仅接管 `/v1/track/url` 的播放地址解析。自定义源 JavaScript 会作为运维可信代码在独立 Worker 中运行，但 Worker 不是安全沙箱，请勿配置未经审核或由用户提交的源地址。

源文件缓存在 `data/lx-sources/`。服务启动时会异步加载，并按进程本地时区每天凌晨 1 点检查更新。

## 本地开发

环境要求：Node.js 22 或更高版本。

```bash
npm ci
npm run dev
```

其他命令：

```bash
npm run build
npm run typecheck
npm test
npm run test:unit
npm run test:integration
npm run test:coverage
```

集成测试会访问真实的上游音乐服务，需要可用网络。

## 项目结构

```text
wow-origin/
├── src/                    # TypeScript 服务、v1 适配器和登录逻辑
├── core/                   # 缓存、日志、并发限制和响应封装
├── platforms/              # QQ 音乐与网易云音乐平台模块
├── types/                  # TypeScript 类型扩展
├── util/                   # 通用工具
├── tests/                  # 单元测试和集成测试
├── data/
│   └── accounts.example.json
├── Dockerfile
├── docker-compose.yml
└── package.json
```

## 安全说明

- `.env`、`data/accounts.json`、`data/lx-sources/` 已加入 `.gitignore`。
- Docker 构建上下文会排除 `.env` 和整个 `data/` 目录，账号 Cookie 不会被写入镜像。
- 不要在源码、Issue、日志或截图中公开 Cookie、`api_access_key`、访问令牌和自定义源私有地址。
- 如果凭据曾进入 Git 历史或公开仓库，仅删除当前文件并不足够；应立即在对应平台撤销或刷新凭据，并清理 Git 历史。

## 致谢

感谢以下项目提供的模板、接口实现、协议研究与设计参考：

- [Aduoer-Music/aduoer-wow-template](https://github.com/Aduoer-Music/aduoer-wow-template)
- [tlyanyu/multiPlatformMusicApi](https://github.com/tlyanyu/multiPlatformMusicApi)
- [neteasecloudmusicapienhanced/api-enhanced](https://github.com/neteasecloudmusicapienhanced/api-enhanced)
- [jsososo/QQMusicApi](https://github.com/jsososo/QQMusicApi)
- [lyswhut/lx-music-desktop](https://github.com/lyswhut/lx-music-desktop)

第三方项目及其代码仍受各自许可证与版权声明约束。

## 开源协议

本项目使用 [MIT License](LICENSE)。

## 免责声明

- 本项目仅供学习参考使用，请勿用于违法、盗版等用途。
- 本项目仅供学习交流使用，请勿用于商业用途。
- 所有音乐、图片、歌词及其他内容的版权归原作者和原平台所有。
- 使用者应遵守所在地法律法规及相关平台服务条款。
- 使用本项目所造成的一切后果由使用者自行承担。
