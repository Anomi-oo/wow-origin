import { randomUUID } from './shims/crypto';
import { storageGet, storageSet } from './storage';

const ACCOUNTS_KEY = 'wow-origin.rewrite.accounts.v1';
const COOKIE_KEYS: Record<ProxyPlatform, string> = {
  qq: 'wow-origin.cookie.qq.v1',
  netease: 'wow-origin.cookie.netease.v1'
};

export type ProxyPlatform = 'qq' | 'netease';

export interface ProxyAccount {
  platform: ProxyPlatform;
  name: string;
  cookie: string;
  apiAccessKey: string;
  stateless: boolean;
  favoriteTrackIds: string[];
  updatedAt: number;
}

export interface ProxyCapturedCookie {
  platform: ProxyPlatform;
  cookie: string;
  capturedAt: number;
}

function readJson<T>(key: string, fallback: T): T {
  const value = storageGet(key);
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function normalizePlatform(value: unknown): ProxyPlatform {
  if (value === 'qq' || value === 'netease') return value;
  throw new Error('platform 必须是 qq 或 netease');
}

function normalizeAccount(value: Partial<ProxyAccount>): ProxyAccount {
  const apiAccessKey = String(value.apiAccessKey || '').trim();
  if (!apiAccessKey) throw new Error('api_access_key 不能为空');
  return {
    platform: normalizePlatform(value.platform),
    name: String(value.name || value.platform || '账号').trim().slice(0, 100),
    cookie: String(value.cookie || '').trim(),
    apiAccessKey,
    stateless: typeof value.stateless === 'boolean' ? value.stateless : true,
    favoriteTrackIds: Array.isArray(value.favoriteTrackIds)
      ? [...new Set(value.favoriteTrackIds.map(String).filter(Boolean))]
      : [],
    updatedAt: Number(value.updatedAt) || Date.now()
  };
}

export class ProxyAccountStore {
  latestCapturedCookie(): ProxyCapturedCookie | undefined {
    const platform = storageGet('wow-origin.cookie.latest-platform.v1');
    const cookie = String(storageGet('wow-origin.cookie.latest-value.v1') || '').trim();
    if ((platform === 'qq' || platform === 'netease') && cookie) {
      return {
        platform,
        cookie,
        capturedAt: Number(storageGet('wow-origin.cookie.latest-at.v1')) || 0
      };
    }
    return undefined;
  }

  capturedCookie(platform: ProxyPlatform): string {
    return String(storageGet(COOKIE_KEYS[platform]) || '').trim();
  }

  list(): ProxyAccount[] {
    const accounts = readJson<unknown>(ACCOUNTS_KEY, []);
    if (!Array.isArray(accounts)) return [];
    const normalized: ProxyAccount[] = [];
    for (const account of accounts) {
      try { normalized.push(normalizeAccount(account as ProxyAccount)); } catch {}
    }
    return normalized;
  }

  find(apiAccessKey: string): ProxyAccount | undefined {
    return this.list().find((account) => account.apiAccessKey === apiAccessKey);
  }

  create(input: {
    platform: unknown;
    name?: unknown;
    cookie?: unknown;
    apiAccessKey?: unknown;
    stateless?: unknown;
    useCapturedCookie?: unknown;
  }): ProxyAccount {
    const accounts = this.list();
    const platform = normalizePlatform(input.platform);
    const requestedKey = String(input.apiAccessKey || '').trim();
    const apiAccessKey = requestedKey || randomUUID().replace(/-/g, '');
    if (accounts.some((account) => account.apiAccessKey === apiAccessKey)) {
      throw new Error('api_access_key 已存在');
    }
    const suppliedCookie = String(input.cookie || '').trim();
    const capturedCookie = input.useCapturedCookie === true
      ? this.capturedCookie(platform)
      : '';
    if (!suppliedCookie && input.useCapturedCookie === true && !capturedCookie) {
      throw new Error(`尚未捕获${platform === 'qq' ? ' QQ 音乐' : '网易云音乐'} Cookie，请先触发 Cookie 捕获脚本或取消该选项`);
    }
    const account = normalizeAccount({
      platform,
      name: String(input.name || '').trim() || undefined,
      cookie: suppliedCookie || capturedCookie,
      apiAccessKey,
      stateless: typeof input.stateless === 'boolean' ? input.stateless : false,
      favoriteTrackIds: [],
      updatedAt: Date.now()
    });
    this.write([...accounts, account]);
    return account;
  }

  update(apiAccessKey: string, changes: Partial<ProxyAccount>): ProxyAccount {
    const accounts = this.list();
    const index = accounts.findIndex((account) => account.apiAccessKey === apiAccessKey);
    if (index < 0) throw new Error('api_access_key 无效');
    const current = accounts[index];
    const account = normalizeAccount({
      ...current,
      ...changes,
      platform: current.platform,
      apiAccessKey: current.apiAccessKey,
      updatedAt: Date.now()
    });
    accounts[index] = account;
    this.write(accounts);
    return account;
  }

  private write(accounts: ProxyAccount[]): void {
    if (!storageSet(JSON.stringify(accounts), ACCOUNTS_KEY)) {
      throw new Error('代理工具账号存储写入失败');
    }
  }
}

export const proxyAccounts = new ProxyAccountStore();
