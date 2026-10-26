import path from 'path';
import { Readable } from 'node:stream';
import express, { Express, Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import { createWowRouter, openApiDocument } from 'aduoer-wow-sdk';
import { createWowContextResolver } from './adapter';
import { preloadData } from './onload';
import { APIError } from './errors';
import { AccountSessionRegistry, extractAuthorizationToken, loadAccountSessions } from './accounts';
import type { AccountStore } from './storage';
import { createLoginRouter } from './login';
import { createDashboardRouter } from './dashboard';
import type { LoginStateStores } from './loginState';
import { createLoginRefreshScheduler, ensureQQLoginFresh, clearAccountLoginRefresh } from './loginRefresh';
import { createLxSourceUpdateScheduler } from './lx-resource/scheduler';
import { clearYTMusicVisitorCache } from './ytmusic/api';
import { YTMusicClient, clearYTMusicTrackCache } from './clients/YTMusicClient';
import { verifyStreamRequest } from './ytmusic/stream';
import { normalizeFragmentedMp4Stream, rebaseMp4Range, sliceByteRange } from './ytmusic/mp4';
import type { LxSourceLifecycle, LxTrackUrlResolver } from './lx-resource/types';

const Result = require('../core/Result');
const Logger = require('../core/Logger');

const platformFactory = require('../platforms/PlatformFactory');
const NeteasePlatform = require('../platforms/netease/NeteasePlatform');
const QQMusicPlatform = require('../platforms/qqmusic/QQMusicPlatform');

const INTERNAL_RESOURCE_ROUTES = new Set(['login/refresh', 'login/check/expired', 'login/phone/send', 'login/phone/check', 'login/cookie']);

class MultiPlatformServer {
  private app: Express | null = null;
  private initialized = false;
  private logger: any;
  private accountSessions: AccountSessionRegistry = { sessions: [], byAccessKey: new Map() };
  private readonly lxSourceManager: AppLxSourceManager;
  private readonly accountStore: AccountStore;
  private readonly cloudflare: boolean;
  private readonly edgeone: boolean;
  private readonly serveStatic: boolean;
  private readonly preload: boolean;
  private readonly adminManagementPassword: string;
  private readonly loginStateStores?: LoginStateStores;
  private readonly loginPageHtml?: string;
  private readonly onRoutes?: (app: Express) => void;
  private accountRefreshAt = 0;
  private accountForceRefreshAt = 0;
  private accountRefresh?: Promise<void>;

  constructor(options: CreateAppOptions = {}) {
    this.adminManagementPassword = options.adminManagementPassword ?? process.env.ADMIN_MANAGEMENT_PASSWORD ?? '';
    this.logger = new Logger({ component: 'server' });
    this.accountStore = options.accountStore ?? loadLocalAccountStore();
    this.lxSourceManager = options.lxSourceManager ?? loadLocalLxSourceManager();
    this.cloudflare = options.cloudflare === true;
    this.edgeone = options.edgeone === true;
    this.loginStateStores = options.loginStateStores;
    this.loginPageHtml = options.loginPageHtml;
    this.onRoutes = options.onRoutes;
    this.serveStatic = options.serveStatic ?? (!this.cloudflare && !this.edgeone);
    this.preload = options.preload ?? (!this.cloudflare && !this.edgeone);
  }

  private shouldExposeOpenApiDocs(): boolean {
    return process.env.NODE_ENV !== 'production';
  }

  async initialize(): Promise<Express> {
    if (this.initialized) {
      return this.app!;
    }

    await this.registerPlatforms();

    this.app = express();
    this.setupMiddleware();
    await this.setupRoutes();

    this.initialized = true;
    this.app.platformFactory = platformFactory;
    this.app.lxSourceManager = this.lxSourceManager;
    this.app.lxSourceUpdateScheduler = createLxSourceUpdateScheduler(this.lxSourceManager);
    this.app.loginRefreshScheduler = createLoginRefreshScheduler({
      registry: this.accountSessions,
      platformFactory,
      accountStore: this.accountStore
    });
    this.logger.compact('info', 'Multi-platform music server initialized', 'debug');
    return this.app;
  }

  async registerPlatforms(): Promise<boolean> {
    try {
      this.logger.compact('platform', 'Registering platform adapters...', 'debug');

      platformFactory.register('netease', NeteasePlatform, { name: 'netease' });
      platformFactory.register('qqmusic', QQMusicPlatform, { name: 'qqmusic' });

      await platformFactory.initialize();

      const platformCount: number = platformFactory.getAvailablePlatforms().length;
      this.logger.compact('platform', `Platform registration completed (${platformCount} platforms loaded)`, 'debug');

      return true;
    } catch (error) {
      this.logger.error('Platform registration failed', error);
      throw error;
    }
  }

  setupMiddleware(): void {
    const { CORS_ALLOW_ORIGIN } = process.env;

    this.app!.set('trust proxy', true);
    this.app!.use(cookieParser());
    if (this.serveStatic) this.app!.use(express.static(path.join(__dirname, '..', 'public')));
    this.accountSessions = loadAccountSessions(this.accountStore);
    // 初始化时已经读取过共享存储，首个请求不必立刻再同步一次。
    this.accountRefreshAt = Date.now();
    (this.accountSessions.onDeleted ??= new Set()).add(session => {
      clearAccountLoginRefresh(session.apiAccessKey);
      clearYTMusicTrackCache(session.cookie);
      clearYTMusicVisitorCache(session.cookie);
      require('../core/PlatformCache').globalCache.clear();
    });
    this.reconcileLxSources();

    this.app!.use((req: Request, res: Response, next: NextFunction) => {
      const isDocsPath = req.path.startsWith('/docs');
      if (req.path !== '/' && !req.path.includes('.') && !(this.shouldExposeOpenApiDocs() && isDocsPath)) {
        res.set({
          'Access-Control-Allow-Credentials': 'true',
          'Access-Control-Allow-Origin': CORS_ALLOW_ORIGIN || (req.headers.origin as string) || '*',
          'Access-Control-Allow-Headers': 'X-Requested-With,Content-Type,Authorization',
          'Access-Control-Allow-Methods': 'POST,PUT,GET,OPTIONS',
          'Content-Type': 'application/json; charset=utf-8',
        });
      }
      req.method === 'OPTIONS' ? res.status(204).end() : next();
    });

    this.app!.use(express.json({ limit: '5mb' }));
    this.app!.use(express.urlencoded({ extended: false, limit: '5mb' }));

    // EdgeOne 的 Blob AccountStore 是“内存同步修改 + 异步持久化”。在发送
    // 写请求响应前完成 flush，避免 Serverless 实例结束后丢失账号变更。
    if (this.accountStore.flush) {
      this.app!.use((req: Request, res: Response, next: NextFunction) => {
        if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
          next();
          return;
        }
        const originalEnd = res.end.bind(res) as (...args: any[]) => any;
        let ending = false;
        (res as any).end = (...args: any[]) => {
          if (ending) return res;
          ending = true;
          void this.accountStore.flush!().then(
            () => originalEnd(...args),
            (error) => {
              this.logger.error('账号状态持久化失败', error);
              if (res.headersSent) {
                originalEnd(...args);
                return;
              }
              // 路由可能已经通过 res.json() 设置了旧响应的 Content-Length，
              // 覆盖响应体时必须一并更新，否则 Node 会截断或挂起连接。
              const body = JSON.stringify(Result.error('账号状态持久化失败', 500));
              res.removeHeader('ETag');
              res.removeHeader('Content-Encoding');
              res.removeHeader('Content-Range');
              res.status(500).set({
                'Content-Type': 'application/json; charset=utf-8',
                'Content-Length': Buffer.byteLength(body),
                'Cache-Control': 'no-store'
              });
              originalEnd(body);
            }
          );
          return res;
        };
        next();
      });
    }
  }

  async setupRoutes(): Promise<void> {
    if (this.shouldExposeOpenApiDocs()) {
      this.app!.get('/openapi.json', (_req: Request, res: Response) => {
        res.json(openApiDocument);
      });
    }

    if (this.accountStore.reload) {
      // 管理后台和登录流程也会校验 api_access_key；定期同步其他实例的
      // 账号，避免刚在另一实例创建的账号在这里被判定为不存在。
      this.app!.use(['/app/api', '/login'], async (req: Request, _res: Response, next: NextFunction) => {
        await this.refreshAccounts(false);
        const bodyKey = typeof req.body?.api_access_key === 'string'
          ? req.body.api_access_key.trim()
          : '';
        if (bodyKey && !this.accountSessions.byAccessKey.has(bodyKey)
          && Date.now() - this.accountRefreshAt >= 2_000) {
          await this.refreshAccounts(true);
        }
        next();
      });
    }
    this.app!.use('/app/api', createDashboardRouter({
      registry: this.accountSessions,
      cloudflare: this.cloudflare,
      edgeone: this.edgeone,
      adminManagementPassword: this.adminManagementPassword,
      accountStore: this.accountStore,
      onAccountsChanged: () => this.reconcileLxSources()
    }));
    this.app!.use('/login', createLoginRouter({
      registry: this.accountSessions,
      platformFactory,
      accountStore: this.accountStore,
      allowAccountLxSources: !this.cloudflare && !this.edgeone,
      loginStateStores: this.loginStateStores,
      loginPageHtml: this.loginPageHtml,
      onAccountsChanged: () => this.reconcileLxSources()
    }));
    this.app!.use('/v1', async (req: Request, _res: Response, next: NextFunction) => {
      const key = extractAuthorizationToken(req.header('Authorization'));
      if (this.accountStore.reload) {
        // 定期同步其他实例写入的账号；新 key 未命中时立即强读一次。
        await this.refreshAccounts(false);
        if (key && !this.accountSessions.byAccessKey.has(key)
          && Date.now() - this.accountRefreshAt >= 2_000) {
          await this.refreshAccounts(true);
        }
      }
      const session = this.accountSessions.byAccessKey.get(key);
      if (!session || session.platform !== 'qq') return next();
      try {
        await ensureQQLoginFresh(session, {
          registry: this.accountSessions,
          platformFactory,
          accountStore: this.accountStore,
          logger: this.logger
        });
        next();
      } catch (error) {
        this.logger.error('QQ 登录状态检查或刷新失败，继续使用当前凭证', error);
        next();
      }
    });
    this.app!.get('/v1/ytmusic/audio/:id', async (req: Request, res: Response, next: NextFunction) => {
      const verified = verifyStreamRequest(this.accountSessions.sessions, String(req.params.id), req.query);
      if (!verified) {
        res.status(403).json(Result.error('音频链接无效或已过期', 403));
        return;
      }
      const controller = new AbortController();
      res.once('close', () => {
        if (!res.writableEnded) controller.abort();
      });
      try {
        const client = new YTMusicClient(verified.account.cookie);
        const audio = await client.getRawTrackUrl(String(req.params.id), verified.quality);
        const range = req.header('range');
        const rebaseRange = audio.format === 'm4a' ? rebaseMp4Range(range) : null;
        const headers: Record<string, string> = { 'Accept-Encoding': 'identity' };
        if (rebaseRange) {
          headers.Range = rebaseRange.upstreamRange;
        } else if (range && /^bytes=\d*-\d*$/.test(range)) {
          headers.Range = range;
        }
        const upstream = await fetch(audio.url, {
          method: req.method === 'HEAD' ? 'HEAD' : 'GET', headers, signal: controller.signal
        });
        if (!upstream.ok || (req.method !== 'HEAD' && !upstream.body)) {
          res.status(502).json(Result.error(`YouTube Music 音频请求失败 (${upstream.status})`, 502));
          return;
        }
        const isMp4Audio = audio.format === 'm4a';
        const upstreamRange = /^bytes 0-\d+\/(\d+)$/.exec(upstream.headers.get('content-range') || '');
        const totalLength = upstreamRange ? Number(upstreamRange[1]) :
          (upstream.status === 200 ? Number(upstream.headers.get('content-length')) : NaN);
        if (rebaseRange && (!Number.isSafeInteger(totalLength) || totalLength <= 0 ||
          (upstream.status !== 200 && !upstreamRange))) {
          res.status(502).json(Result.error('YouTube Music 音频范围响应无效', 502));
          return;
        }
        if (rebaseRange && rebaseRange.start >= totalLength) {
          res.status(416).set('Content-Range', `bytes */${totalLength}`).end();
          return;
        }
        const responseEnd = rebaseRange ? Math.min(rebaseRange.end ?? totalLength - 1, totalLength - 1) : 0;
        res.status(rebaseRange ? 206 : upstream.status);
        for (const key of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
          const value = upstream.headers.get(key);
          if (value) res.set(key, value);
        }
        if (rebaseRange) {
          res.set('Content-Range', `bytes ${rebaseRange.start}-${responseEnd}/${totalLength}`);
          res.set('Content-Length', String(responseEnd - rebaseRange.start + 1));
        }
        const lastModified = upstream.headers.get('last-modified');
        if (lastModified) {
          const parsed = Date.parse(lastModified);
          // The normalized MP4 is a new representation; invalidate previously cached headers in Aduoer.
          res.set('Last-Modified', isMp4Audio && Number.isFinite(parsed)
            ? new Date(parsed + 1000).toUTCString() : lastModified);
        }
        const upstreamEtag = upstream.headers.get('etag');
        if (upstreamEtag) res.set('ETag', isMp4Audio ? `W/"ytm-mdhd-v1-${upstreamEtag.replace(/[^a-zA-Z0-9]/g, '')}"` : upstreamEtag);
        res.set('Cache-Control', 'private, no-store');
        if (req.method === 'HEAD') {
          res.end();
          return;
        }
        const handleStreamError = (error: Error) => {
          if (controller.signal.aborted && error.name === 'AbortError') return;
          this.logger.error('YouTube Music audio stream failed', error);
          if (!res.destroyed) res.destroy(error);
        };
        const source = Readable.fromWeb(upstream.body as any).on('error', handleStreamError);
        const startsAtZero = upstream.status === 200 ||
          (upstream.status === 206 && /^bytes 0-\d+\//.test(upstream.headers.get('content-range') || ''));
        const output = startsAtZero && isMp4Audio
          ? source.pipe(normalizeFragmentedMp4Stream().on('error', handleStreamError))
          : source;
        if (rebaseRange) output.pipe(sliceByteRange(rebaseRange.start, responseEnd + 1).on('error', handleStreamError)).pipe(res);
        else output.pipe(res);
      } catch (error) {
        if (controller.signal.aborted || res.destroyed) return;
        if (!res.headersSent) next(error);
        else res.destroy(error as Error);
      }
    });
    this.app!.use(createWowRouter({
      resolveContext: createWowContextResolver(this.accountSessions, this.lxSourceManager),
      onError: (error, request) => this.logger.error('Wow v1 request failed', error, { url: request.url })
    }));
    if (this.preload) {
      void preloadData(platformFactory, this.accountSessions, this.lxSourceManager).catch((error) => {
        this.logger.error('Background favorites preload failed', error);
      });
    }

    const resourceRoutes: string[] = platformFactory
      .getAvailableRoutes()
      .filter((route: string) => !INTERNAL_RESOURCE_ROUTES.has(route));

    resourceRoutes.forEach((route: string) => {
      this.app!.all(`/${route}`, async (req: Request, res: Response) => {
        await this.handleResourceAPI(req, res, route);
      });
    });

    this.onRoutes?.(this.app!);

    this.app!.use((_req: Request, res: Response) => {
      res.status(404).json(Result.error('API endpoint not found', 404));
    });

    this.app!.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
      this.logger.error('Unhandled error', error, { url: _req.url });
      if (error instanceof APIError) {
        res.status(error.status).json(Result.error(error.message, error.status));
        return;
      }
      res.status(500).json(Result.error('Internal server error', 500));
    });
  }

  private reconcileLxSources(): void {
    this.lxSourceManager.reconcileAccountSources(
      this.accountSessions.sessions.map((session) => session.lxSource)
    );
  }

  /**
   * 从共享 AccountStore 同步账号。EdgeOne 的多个函数实例各自缓存 registry，
   * 因此 v1 请求会定期刷新，并在遇到未知 key 时立即强制刷新。
   */
  private async refreshAccounts(force: boolean): Promise<void> {
    const reload = this.accountStore.reload;
    if (!reload) return;
    const now = Date.now();
    if (force) {
      // 未携带有效 key 的请求也会走到这里；限制强制刷新频率，避免被随机
      // token 放大成对共享存储的持续读取。
      if (now - this.accountForceRefreshAt < 2_000) return;
      this.accountForceRefreshAt = now;
    } else if (now - this.accountRefreshAt < 30_000) {
      return;
    }
    if (this.accountRefresh) {
      await this.accountRefresh;
      return;
    }
    this.accountRefresh = (async () => {
      try {
        const changed = await reload.call(this.accountStore);
        if (changed === false) return;
        const next = loadAccountSessions(this.accountStore);
        const previous = this.accountSessions.byAccessKey;
        const merged = next.sessions.map((session) => {
          const existing = previous.get(session.apiAccessKey);
          if (!existing || existing.platform !== session.platform) return session;
          const cookieChanged = existing.cookie !== session.cookie;
          const previousCookie = existing.cookie;
          existing.name = session.name;
          existing.cookie = session.cookie;
          existing.stateless = session.stateless;
          existing.useLuoxue = session.useLuoxue;
          existing.lxSource = session.lxSource;
          existing.deviceId = session.deviceId;
          existing.deviceState = session.deviceState;
          if (cookieChanged) {
            // 其他实例更新了 Cookie，旧实例的收藏缓存必须失效。
            existing.favoriteTrackIds.clear();
            existing.userPlaylistIds.clear();
            existing.favoriteArtistIds.clear();
            existing.favoriteAlbumIds.clear();
            existing.favoriteArtistsLoaded = false;
            existing.favoriteAlbumsLoaded = false;
            clearYTMusicTrackCache(previousCookie);
            clearYTMusicVisitorCache(previousCookie);
          }
          return existing;
        });
        const nextKeys = new Set(merged.map((session) => session.apiAccessKey));
        const removed = this.accountSessions.sessions.filter(
          (session) => !nextKeys.has(session.apiAccessKey)
        );
        for (const session of removed) {
          for (const cleanup of this.accountSessions.onDeleted ?? []) cleanup(session);
        }
        this.accountSessions.sessions = merged;
        this.accountSessions.byAccessKey = new Map(
          merged.map((session) => [session.apiAccessKey, session])
        );
        this.reconcileLxSources();
      } catch (error) {
        this.logger.error('同步账号数据库失败', error);
      } finally {
        this.accountRefreshAt = Date.now();
      }
    })();
    try {
      await this.accountRefresh;
    } finally {
      this.accountRefresh = undefined;
    }
  }

  async handleResourceAPI(req: Request, res: Response, route: string): Promise<void> {
    const startTime = Date.now();

    try {
      if (req.cookies) {
        if (req.cookies.MUSIC_U && !req.query.MUSIC_U) {
          req.query.MUSIC_U = req.cookies.MUSIC_U;
        }
        if (req.cookies.uin && !req.query.uin) {
          req.query.uin = req.cookies.uin;
        }
        if (req.cookies.qm_keyst && !req.query.qm_keyst) {
          req.query.qm_keyst = req.cookies.qm_keyst;
        }
      }

      const platformName = (req.query.platform as string) || req.body?.platform || 'netease';

      const platform = platformFactory.getPlatform(platformName);
      const result = await platform.callModule(route, req);

      res.status(result.code).json(result);

    } catch (error) {
      const responseTime = Date.now() - startTime;

      this.logger.error('API request failed', error, {
        route,
        platform: (req.query.platform as string) || req.body?.platform || 'unknown',
        responseTime
      });

      const errorResult = Result.error(error, 500);
      res.status(errorResult.code).json(errorResult);
    }
  }

  stop(): void {
    if (this.app && this.app.server) {
      this.app.server.close();
      this.logger.info('Server stopped');
    }
  }
}

/** 创建并初始化 Express 应用；监听端口由 server.ts 负责。 */
export interface CreateAppOptions {
  adminManagementPassword?: string;
  accountStore?: AccountStore;
  lxSourceManager?: AppLxSourceManager;
  cloudflare?: boolean;
  edgeone?: boolean;
  serveStatic?: boolean;
  preload?: boolean;
  loginStateStores?: LoginStateStores;
  loginPageHtml?: string;
  /** 注册平台路由之后、404 之前的扩展点（如 EdgeOne 定时任务路由）。 */
  onRoutes?: (app: Express) => void;
}

export interface AppLxSourceManager extends LxTrackUrlResolver, LxSourceLifecycle {
  reconcileAccountSources(sourceGroups: readonly (readonly string[])[]): void;
}

function loadLocalAccountStore(): AccountStore {
  const localRequire = require;
  return localRequire('./storage').createLocalAccountStore();
}

function loadLocalLxSourceManager(): AppLxSourceManager {
  const localRequire = require;
  return localRequire('./lx-resource').createLxSourceManager();
}

export async function createApp(options: CreateAppOptions = {}): Promise<Express> {
  return new MultiPlatformServer(options).initialize();
}

export { MultiPlatformServer, platformFactory };
