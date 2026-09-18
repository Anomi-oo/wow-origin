import http from 'node:http';
import { handleAsNodeRequest } from 'cloudflare:node';
import { DurableObject } from 'cloudflare:workers';
import { platformModules } from './generated/platform-modules.js';
import { DurableObjectAccountStore } from './account-store';
import { CloudflareLxSourceManager } from './lx-manager';

(globalThis as any).__wowPlatformModules__ = platformModules;

const NODE_SERVER_PORT = 8788;
const ASSET_PATHS = new Set(['/', '/login', '/app.js', '/styles.css']);

export interface Env {
  ORIGIN: DurableObjectNamespace<OriginDurableObject>;
  ASSETS: Fetcher;
}

export class OriginDurableObject extends DurableObject<Env> {
  private readonly ready: Promise<void>;
  private app: any;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ready = ctx.blockConcurrencyWhile(async () => {
      const [{ createApp }] = await Promise.all([import('../src/app')]);
      const accountStore = new DurableObjectAccountStore(ctx.storage.sql as any);
      const lxSourceManager = new CloudflareLxSourceManager();
      this.app = await createApp({
        accountStore,
        lxSourceManager,
        cloudflare: true,
        serveStatic: false,
        preload: false
      });
      await new Promise<void>((resolve, reject) => {
        const server = http.createServer(this.app);
        server.once('error', reject);
        server.listen(NODE_SERVER_PORT, () => {
          server.off('error', reject);
          resolve();
        });
      });
    });
  }

  async fetch(request: Request): Promise<Response> {
    await this.ready;
    return handleAsNodeRequest(NODE_SERVER_PORT, request, this.env);
  }

  async refreshLogins(): Promise<void> {
    await this.ready;
    await this.app.loginRefreshScheduler?.runNow();
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if ((request.method === 'GET' || request.method === 'HEAD') && ASSET_PATHS.has(url.pathname)) {
      const assetUrl = new URL(url.pathname === '/login' ? '/' : url.pathname, url);
      return env.ASSETS.fetch(new Request(assetUrl, request));
    }
    return env.ORIGIN.getByName('primary').fetch(request);
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(env.ORIGIN.getByName('primary').refreshLogins());
  }
} satisfies ExportedHandler<Env>;
