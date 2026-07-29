import path from 'path';
import express, { Express, Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import { createWowRouter, openApiDocument } from 'aduoer-wow-sdk';
import { createWowContextResolver } from './adapter';
import { preloadData } from './onload';
import { APIError } from './errors';
import { AccountSessionRegistry, loadAccountSessions } from './accounts';
import { createLoginRouter } from './login';
import { createLoginRefreshScheduler } from './loginRefresh';
import {
  createLxSourceManager,
  createLxSourceUpdateScheduler,
  type LxSourceManager
} from './lx-resource';

const Result = require('../core/Result');
const Logger = require('../core/Logger');

const platformFactory = require('../platforms/PlatformFactory');
const NeteasePlatform = require('../platforms/netease/NeteasePlatform');
const QQMusicPlatform = require('../platforms/qqmusic/QQMusicPlatform');

const INTERNAL_RESOURCE_ROUTES = new Set(['login/refresh']);

class MultiPlatformServer {
  private app: Express | null = null;
  private initialized = false;
  private logger: any;
  private accountSessions: AccountSessionRegistry = { sessions: [], byAccessKey: new Map() };
  private readonly lxSourceManager: LxSourceManager;

  constructor() {
    this.logger = new Logger({ component: 'server' });
    this.lxSourceManager = createLxSourceManager();
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
      platformFactory
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
    this.app!.use(express.static(path.join(__dirname, '..', 'public')));
    this.accountSessions = loadAccountSessions();

    this.app!.use((req: Request, res: Response, next: NextFunction) => {
      const isDocsPath = req.path.startsWith('/docs');
      if (req.path !== '/' && !req.path.includes('.') && !(this.shouldExposeOpenApiDocs() && isDocsPath)) {
        res.set({
          'Access-Control-Allow-Credentials': 'true',
          'Access-Control-Allow-Origin': CORS_ALLOW_ORIGIN || (req.headers.origin as string) || '*',
          'Access-Control-Allow-Headers': 'X-Requested-With,Content-Type,Authorization',
          'Access-Control-Allow-Methods': 'POST,GET,OPTIONS',
          'Content-Type': 'application/json; charset=utf-8',
        });
      }
      req.method === 'OPTIONS' ? res.status(204).end() : next();
    });

    this.app!.use(express.json({ limit: '5mb' }));
    this.app!.use(express.urlencoded({ extended: false, limit: '5mb' }));
  }

  async setupRoutes(): Promise<void> {
    if (this.shouldExposeOpenApiDocs()) {
      this.app!.get('/openapi.json', (_req: Request, res: Response) => {
        res.json(openApiDocument);
      });
    }

    this.app!.use('/login', createLoginRouter({ registry: this.accountSessions, platformFactory }));
    this.app!.use(createWowRouter({
      resolveContext: createWowContextResolver(this.accountSessions, this.lxSourceManager),
      onError: (error, request) => this.logger.error('Wow v1 request failed', error, { url: request.url })
    }));
    await preloadData(platformFactory, this.accountSessions, this.lxSourceManager);

    const resourceRoutes: string[] = platformFactory
      .getAvailableRoutes()
      .filter((route: string) => !INTERNAL_RESOURCE_ROUTES.has(route));

    resourceRoutes.forEach((route: string) => {
      this.app!.all(`/${route}`, async (req: Request, res: Response) => {
        await this.handleResourceAPI(req, res, route);
      });
    });

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
export async function createApp(): Promise<Express> {
  return new MultiPlatformServer().initialize();
}

export { MultiPlatformServer, platformFactory };
