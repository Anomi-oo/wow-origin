import platformModules from './generated/platform-modules';
import neteaseRequest from '../platforms/netease/util/request.js';
import qqmusicRequest from '../platforms/qqmusic/util/request.js';

type ModuleFunction = (query: Record<string, any>, request: (...args: any[]) => Promise<any>) => Promise<any> | any;

function success(data: any): any {
  if (data && typeof data === 'object' && !Array.isArray(data)) return { ...data, code: 200 };
  return { data, code: 200 };
}

class RewritePlatform {
  readonly modules: Map<string, ModuleFunction>;

  constructor(readonly name: 'netease' | 'qqmusic', modules: Record<string, ModuleFunction>) {
    this.modules = new Map(Object.entries(modules));
  }

  async callModule(route: string, request: { query?: Record<string, any>; body?: Record<string, any> }): Promise<any> {
    const moduleFunction = this.modules.get(route);
    if (!moduleFunction) return { code: 500, message: `Module ${route} not found in ${this.name}`, data: null };
    const query = { ...(request.query || {}), ...(request.body || {}) };
    try {
      const handler = this.name === 'netease'
        ? (uri: string, data: Record<string, any>, options: Record<string, any> = {}) => neteaseRequest(uri, data, {
            ...options,
            ip: '116.25.1.1',
            deviceId: 'A'.repeat(52)
          })
        : (module: string, method: string, data: Record<string, any>, options: Record<string, any> = {}) => (
            (qqmusicRequest as any).createRequest(module, method, data, options)
          );
      return success(await moduleFunction(query, handler));
    } catch (error) {
      return { code: 500, message: (error as Error)?.message || String(error), data: null };
    }
  }
}

class RewritePlatformFactory {
  private readonly platforms = new Map<string, RewritePlatform>();

  register(name: 'netease' | 'qqmusic', modules: Record<string, ModuleFunction>): void {
    this.platforms.set(name, new RewritePlatform(name, modules));
  }

  getPlatform(name: string): RewritePlatform {
    const platform = this.platforms.get(name);
    if (!platform) throw new Error(`Platform '${name}' is not registered`);
    return platform;
  }

  getAvailablePlatforms(): string[] {
    return [...this.platforms.keys()];
  }
}

export function initializeRewritePlatforms(): RewritePlatformFactory {
  const factory = new RewritePlatformFactory();
  factory.register('netease', (platformModules.netease || {}) as unknown as Record<string, ModuleFunction>);
  factory.register('qqmusic', (platformModules.qqmusic || {}) as unknown as Record<string, ModuleFunction>);
  (globalThis as any).__wowPlatformModules__ = platformModules;
  (globalThis as any).__musicPlatformFactory__ = factory;
  return factory;
}
