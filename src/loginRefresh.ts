import {
  type AccountSessionRegistry,
  updateAccountCookieByAccessKey
} from './accounts';
import type { MusicPlatform } from './types';

const Logger = require('../core/Logger');

const LOGIN_REFRESH_ROUTE = 'login/refresh';
const REFRESH_HOUR = 1;

type ResourcePlatform = 'qqmusic' | 'netease';

interface MusicPlatformLike {
  callModule(route: string, request: any): Promise<any>;
}

interface PlatformFactoryLike {
  getPlatform(name: ResourcePlatform): MusicPlatformLike;
}

interface LoginRefreshOptions {
  registry: AccountSessionRegistry;
  platformFactory: PlatformFactoryLike;
  workDir?: string;
  logger?: any;
}

export interface LoginRefreshSummary {
  total: number;
  refreshed: number;
  unchanged: number;
  failed: number;
}

export interface LoginRefreshScheduler {
  start(): void;
  stop(): void;
  runNow(): Promise<LoginRefreshSummary>;
}

function toResourcePlatform(platform: MusicPlatform): ResourcePlatform {
  return platform === 'qq' ? 'qqmusic' : 'netease';
}

function platformDisplayName(platform: MusicPlatform): string {
  return platform === 'qq' ? 'QQ 音乐' : '网易云音乐';
}

function parseCookie(cookie: string): Record<string, string> {
  const values: Record<string, string> = {};

  String(cookie || '').split(';').forEach((item) => {
    const separatorIndex = item.indexOf('=');
    if (separatorIndex <= 0) return;

    const key = item.slice(0, separatorIndex).trim();
    const value = item.slice(separatorIndex + 1).trim();
    if (key && value) values[key] = value;
  });

  return values;
}

function serializeCookie(values: Record<string, unknown>): string {
  return Object.entries(values)
    .filter(([key, value]) => key && value !== undefined && value !== null && String(value).trim())
    .map(([key, value]) => `${key}=${String(value).trim()}`)
    .join('; ');
}

function normalizeRefreshedCookie(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key, item]) => key && item !== undefined && item !== null && String(item).trim())
  );
}

/** 计算距离进程本地时区下一次凌晨 01:00 的毫秒数。 */
export function millisecondsUntilNextLoginRefresh(now: Date = new Date()): number {
  const nextRefresh = new Date(now);
  nextRefresh.setHours(REFRESH_HOUR, 0, 0, 0);

  if (nextRefresh.getTime() <= now.getTime()) {
    nextRefresh.setDate(nextRefresh.getDate() + 1);
  }

  return Math.max(1, nextRefresh.getTime() - now.getTime());
}

/**
 * 顺序刷新所有已配置 cookie 的音乐账号，并将成功返回的新 cookie 同步到磁盘与内存。
 * 上游失败、登录过期或没有返回非空 cookie 时只记录错误，保留原登录信息。
 */
export async function refreshLoginSessions({
  registry,
  platformFactory,
  workDir = process.cwd(),
  logger = new Logger({ component: 'login-refresh' })
}: LoginRefreshOptions): Promise<LoginRefreshSummary> {
  const sessions = registry.sessions.filter((session) => session.cookie.trim());
  const summary: LoginRefreshSummary = {
    total: sessions.length,
    refreshed: 0,
    unchanged: 0,
    failed: 0
  };

  if (sessions.length === 0) {
    logger.info('没有需要刷新的音乐账号');
    return summary;
  }

  for (const session of sessions) {
    const resourcePlatform = toResourcePlatform(session.platform);
    const displayName = platformDisplayName(session.platform);

    try {
      const currentCookie = parseCookie(session.cookie);
      const platform = platformFactory.getPlatform(resourcePlatform);
      const result = await platform.callModule(LOGIN_REFRESH_ROUTE, {
        query: {
          ...currentCookie,
          platform: resourcePlatform,
          timestamp: Date.now()
        },
        body: {},
        ip: 'internal-scheduler',
        connection: { remoteAddress: 'internal-scheduler' }
      });
      const upstreamCode = Number(result?.body?.code ?? 200);
      const refreshedValues = normalizeRefreshedCookie(result?.cookie);

      if (!result || result.code !== 200 || upstreamCode !== 200) {
        throw new Error(result?.message || result?.body?.message || result?.body?.msg || `${displayName}登录状态已过期`);
      }
      if (result.refreshed === false) {
        summary.unchanged += 1;
        logger.info(`${displayName}账号 "${session.name}" 登录凭证仍有效，本次无需更新`);
        continue;
      }
      if (Object.keys(refreshedValues).length === 0) {
        throw new Error(`${displayName}刷新成功但未返回新的 cookie`);
      }

      const refreshedCookie = serializeCookie({
        ...currentCookie,
        ...refreshedValues
      });
      if (!refreshedCookie) {
        throw new Error(`${displayName}刷新后的 cookie 无效`);
      }

      updateAccountCookieByAccessKey(
        session.apiAccessKey,
        session.platform,
        refreshedCookie,
        registry,
        workDir
      );

      summary.refreshed += 1;
      logger.info(`${displayName}账号 "${session.name}" 登录状态刷新成功`);
    } catch (error) {
      summary.failed += 1;
      logger.error(`${displayName}账号 "${session.name}" 登录状态刷新失败，已保留原 cookie`, error);
    }
  }

  logger.info(`登录状态刷新完成：更新 ${summary.refreshed}，无需更新 ${summary.unchanged}，失败 ${summary.failed}`);
  return summary;
}

/** 创建每天凌晨 01:00 执行的音乐账号登录态刷新调度器。 */
export function createLoginRefreshScheduler(options: LoginRefreshOptions): LoginRefreshScheduler {
  const logger = options.logger || new Logger({ component: 'login-refresh' });
  let timer: NodeJS.Timeout | undefined;
  let running = false;
  let started = false;

  const scheduleNext = (): void => {
    if (!started) return;
    if (timer) clearTimeout(timer);

    const delay = millisecondsUntilNextLoginRefresh();
    const nextRefreshAt = new Date(Date.now() + delay);
    timer = setTimeout(async () => {
      if (running) {
        logger.warn('上一次登录状态刷新仍在执行，本次任务已跳过');
      } else {
        running = true;
        try {
          await refreshLoginSessions({ ...options, logger });
        } catch (error) {
          logger.error('登录状态定时刷新任务执行失败', error);
        } finally {
          running = false;
        }
      }

      if (started) scheduleNext();
    }, delay);
    timer.unref();

    logger.info(`登录状态自动刷新已调度：${nextRefreshAt.toLocaleString()}`);
  };

  return {
    start(): void {
      if (started) return;
      started = true;
      scheduleNext();
    },
    stop(): void {
      started = false;
      if (!timer) return;
      clearTimeout(timer);
      timer = undefined;
    },
    runNow(): Promise<LoginRefreshSummary> {
      return refreshLoginSessions({ ...options, logger });
    }
  };
}
