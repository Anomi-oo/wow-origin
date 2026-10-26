import express, { type Express } from 'express';
import { platformModules } from '../cloudflare/generated/platform-modules.js';
import { CloudflareLxSourceManager } from '../cloudflare/lx-manager';
import { EdgeOneAccountStore } from './account-store';
import { createEdgeOneLoginStateStores } from './login-state';
import { appJs, loginPageHtml, stylesCss } from './generated/login-page.js';

// 必须在 createApp() 初始化平台之前设置静态模块表：
// EdgeOne 的构建产物不包含 platforms/**/module 目录。
(globalThis as any).__wowPlatformModules__ = platformModules;

// EdgeOne Pages CLI 通过源码中的 `export { app ... }` 识别框架函数，因此导出的变量必须命名为 app。
const app = express();
let appPromise: Promise<Express> | undefined;
let lastLoginRefreshAt = 0;

// EdgeOne 的 catch-all 函数会先于静态资源匹配，需在函数内直接返回登录页资源。
const staticAssets: Record<string, { type: string; body: string }> = {
  '/': { type: 'text/html; charset=utf-8', body: loginPageHtml },
  '/index.html': { type: 'text/html; charset=utf-8', body: loginPageHtml },
  '/login': { type: 'text/html; charset=utf-8', body: loginPageHtml },
  '/app.js': { type: 'text/javascript; charset=utf-8', body: appJs },
  '/styles.css': { type: 'text/css; charset=utf-8', body: stylesCss }
};

function initialize(): Promise<Express> {
  if (appPromise) return appPromise;
  appPromise = (async () => {
    const { createApp } = await import('../src/app');
    const accountStore = await EdgeOneAccountStore.open();
    return createApp({
      accountStore,
      lxSourceManager: new CloudflareLxSourceManager(),
      loginStateStores: createEdgeOneLoginStateStores(accountStore.blob),
      loginPageHtml,
      edgeone: true,
      serveStatic: false,
      preload: false,
      onRoutes(application) {
        // edgeone.json schedules 以 POST 请求触发该路径。
        application.post('/internal/cron/login-refresh', async (_req, res, next) => {
          try {
            const now = Date.now();
            if (now - lastLoginRefreshAt < 60_000) {
              res.json({ code: 200, data: { skipped: true } });
              return;
            }
            lastLoginRefreshAt = now;
            const summary = await application.loginRefreshScheduler?.runNow();
            res.json({ code: 200, data: summary ?? null });
          } catch (error) {
            next(error);
          }
        });
      }
    });
  })().catch((error) => {
    appPromise = undefined;
    throw error;
  });
  return appPromise;
}

app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    next();
    return;
  }
  const path = req.path.length > 1 ? req.path.replace(/\/+$/, '') : req.path;
  const asset = staticAssets[path];
  if (!asset) {
    next();
    return;
  }
  res.setHeader('Content-Type', asset.type);
  res.setHeader('Cache-Control', 'no-store');
  res.send(asset.body);
});

app.use((req, res, next) => {
  void initialize().then((application) => application(req, res, next), next);
});

app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[edgeone] 初始化请求处理失败', error);
  if (res.headersSent) return;
  res.status(500).json({ code: 500, message: '服务初始化失败', data: null });
});

export { app };
