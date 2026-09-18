import path from 'path';
import { randomUUID } from 'crypto';
import type { MusicPlatform } from './types';
import { createLocalAccountStore, type AccountStore } from './storage/accounts';

export interface RawMusicAccount {
  platform?: unknown;
  name?: unknown;
  cookie?: unknown;
  api_access_key?: unknown;
  stateless?: unknown;
  useLuoxue?: unknown;
  lxSource?: unknown;
}

export interface MusicAccountSession {
  platform: MusicPlatform;
  name: string;
  cookie: string;
  apiAccessKey: string;
  stateless: boolean;
  useLuoxue: boolean;
  lxSource: string[];
  favoriteTrackIds: Set<string>;
}

export interface AccountSessionRegistry {
  sessions: MusicAccountSession[];
  byAccessKey: Map<string, MusicAccountSession>;
}

export interface UpdateAccountCookieResult {
  session: MusicAccountSession;
  filePath: string;
}

export interface CreateAccountResult {
  session: MusicAccountSession;
  filePath: string;
}

export interface UpdateAccountConfigInput {
  name: unknown;
  stateless: unknown;
  useLuoxue: unknown;
  lxSource: unknown;
}

export const sessionsTemplate: RawMusicAccount[] = [
  {
    platform: 'qq',
    name: 'QQ 音乐1',
    cookie: '',
    api_access_key: '',
    stateless: false,
    useLuoxue: true,
    lxSource: []
  },
  {
    platform: 'qq',
    name: 'QQ 音乐',
    cookie: '',
    api_access_key: '',
    stateless: false,
    useLuoxue: true,
    lxSource: []
  },
  {
    platform: 'netease',
    name: '网易云音乐',
    cookie: '',
    api_access_key: '',
    stateless: false,
    useLuoxue: true,
    lxSource: []
  }
];

export function normalizeAccountPlatform(value: unknown): MusicPlatform {
  const platform = String(value || '').trim().toLowerCase();
  if (platform === 'qq') return 'qq';
  if (platform === 'netease') return 'netease';
  throw new Error(`不支持的平台: ${platform || '<empty>'}`);
}

/** 账号未配置时遵循 SDK 默认值，显式配置只接受 JSON boolean。 */
function normalizeAccountStateless(value: unknown): boolean {
  if (value === undefined) return true;
  if (typeof value !== 'boolean') {
    throw new Error('stateless 必须是 boolean');
  }
  return value;
}

function normalizeAccountUseLuoxue(value: unknown): { value: boolean; invalid: boolean } {
  if (value === undefined) return { value: true, invalid: false };
  if (typeof value === 'boolean') return { value, invalid: false };
  return { value: false, invalid: true };
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** 严格校验来自网页的账号洛雪源配置。 */
export function normalizeAccountLxSources(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error('lxSource 必须是数组');
  const sources: string[] = [];
  const seen = new Set<string>();

  value.forEach((item) => {
    if (typeof item !== 'string') throw new Error('lxSource 中的地址必须是字符串');
    const source = item.trim();
    if (!source) return;
    if (!isHttpUrl(source)) throw new Error(`洛雪源地址无效: ${source}`);
    if (seen.has(source)) return;
    seen.add(source);
    sources.push(source);
  });

  if (sources.length > 10) throw new Error('lxSource 最多配置 10 个地址');
  return sources;
}

/** 手工配置错误不应阻止账号注册；无效项会被忽略并记录警告。 */
function loadAccountLxSources(value: unknown, accountName: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    console.warn(`[accounts] 账号 "${accountName}" 的 lxSource 必须是数组，已按空数组处理`);
    return [];
  }

  const valid: string[] = [];
  const seen = new Set<string>();
  value.forEach((item) => {
    const source = typeof item === 'string' ? item.trim() : '';
    if (!source || !isHttpUrl(source)) {
      console.warn(`[accounts] 账号 "${accountName}" 包含无效的 lxSource，已忽略`);
      return;
    }
    if (seen.has(source)) return;
    seen.add(source);
    if (valid.length < 10) valid.push(source);
  });
  if (seen.size > 10) {
    console.warn(`[accounts] 账号 "${accountName}" 的 lxSource 超过 10 个，仅使用前 10 个`);
  }
  return valid;
}

function printTemplate(): void {
  console.log('[accounts] accounts.json 配置模板:');
  console.log(JSON.stringify(sessionsTemplate, null, 2));
}

export function accountsFilePath(workDir: string = process.cwd()): string {
  return path.join(workDir, 'data', 'accounts.json');
}

export type AccountStoreInput = string | AccountStore;

function resolveAccountStore(input: AccountStoreInput = process.cwd()): AccountStore {
  return typeof input === 'string' ? createLocalAccountStore(input) : input;
}

function collectAccountKeys(registry: AccountSessionRegistry, rawAccounts: RawMusicAccount[]): Set<string> {
  const keys = new Set<string>(registry.byAccessKey.keys());
  rawAccounts.forEach((raw) => {
    if (!raw || typeof raw !== 'object') return;
    const key = String(raw.api_access_key || '').trim();
    if (key) keys.add(key);
  });
  return keys;
}

export function generateAccountAccessKey(
  registry: AccountSessionRegistry,
  storeInput: AccountStoreInput = process.cwd()
): string {
  const rawAccounts = resolveAccountStore(storeInput).list();
  const existingKeys = collectAccountKeys(registry, rawAccounts);

  for (let index = 0; index < 10; index += 1) {
    const key = randomUUID().replace(/-/g, '');
    if (!existingKeys.has(key)) return key;
  }

  throw new Error('生成 api_access_key 失败，请重试');
}

export function extractAuthorizationToken(value: string | undefined): string {
  const authorization = String(value || '').trim();
  if (!authorization) return '';
  const bearerMatch = authorization.match(/^Bearer\s+(.+)$/i);
  return (bearerMatch ? bearerMatch[1] : authorization).trim();
}

/**
 * 读取并校验 v1 多账号配置。配置异常只记录日志并返回空 registry，
 * 避免账号配置问题阻止服务启动。
 */
export function loadAccountSessions(storeInput: AccountStoreInput = process.cwd()): AccountSessionRegistry {
  const emptyRegistry: AccountSessionRegistry = { sessions: [], byAccessKey: new Map() };
  let rawAccounts: unknown;
  try {
    rawAccounts = resolveAccountStore(storeInput).list();
  } catch (error) {
    console.error('[accounts] 读取账号数据库失败', error);
    printTemplate();
    return emptyRegistry;
  }
  if (!Array.isArray(rawAccounts)) return emptyRegistry;

  const parsedSessions: MusicAccountSession[] = [];
  const keyCounts = new Map<string, number>();

  rawAccounts.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object') {
      console.warn(`[accounts] 忽略第 ${index + 1} 个账号：账号配置必须是对象`);
      return;
    }

    const account = raw as RawMusicAccount;
    const apiAccessKey = String(account.api_access_key || '').trim();
    if (!apiAccessKey) {
      console.warn(`[accounts] 忽略第 ${index + 1} 个账号：api_access_key 未填写或为空`);
      return;
    }

    try {
      const platform = normalizeAccountPlatform(account.platform);
      const accountName = String(account.name || `${platform}-${index + 1}`).trim();
      const stateless = normalizeAccountStateless(account.stateless);
      const useLuoxue = normalizeAccountUseLuoxue(account.useLuoxue);
      if (useLuoxue.invalid) {
        console.warn(
          `[accounts] 账号 "${accountName}" 的 useLuoxue 必须是 boolean，已按 false 处理`
        );
      }
      parsedSessions.push({
        platform,
        name: accountName,
        cookie: String(account.cookie || ''),
        apiAccessKey,
        stateless,
        useLuoxue: useLuoxue.value,
        lxSource: loadAccountLxSources(account.lxSource, accountName),
        favoriteTrackIds: new Set<string>()
      });
      keyCounts.set(apiAccessKey, (keyCounts.get(apiAccessKey) || 0) + 1);
    } catch (error) {
      console.warn(`[accounts] 忽略第 ${index + 1} 个账号：${(error as Error).message}`);
    }
  });

  const sessions = parsedSessions.filter((session) => {
    if ((keyCounts.get(session.apiAccessKey) || 0) > 1) {
      console.warn(`[accounts] 忽略账号 "${session.name}"：api_access_key 重复`);
      return false;
    }
    return true;
  });

  const byAccessKey = new Map<string, MusicAccountSession>();
  sessions.forEach((session) => byAccessKey.set(session.apiAccessKey, session));
  console.log(`[accounts] 已注册 ${sessions.length} 个账号`);

  return { sessions, byAccessKey };
}

/**
 * 按 api_access_key 更新账号 cookie，并同步刷新内存 registry。
 * 登录入口依赖这个函数把扫码结果持久化到账号数据库。
 */
export function updateAccountCookieByAccessKey(
  apiAccessKey: string,
  platformValue: unknown,
  cookie: string,
  registry: AccountSessionRegistry,
  storeInput: AccountStoreInput = process.cwd()
): UpdateAccountCookieResult {
  const token = String(apiAccessKey || '').trim();
  if (!token) {
    throw new Error('api_access_key 是必填参数');
  }

  const platform = normalizeAccountPlatform(platformValue);
  const session = registry.byAccessKey.get(token);
  if (!session) {
    throw new Error('api_access_key 无效或未注册到账号数据库');
  }
  if (session.platform !== platform) {
    throw new Error('更新已有账号时不能修改平台');
  }

  const normalizedCookie = String(cookie || '').trim();
  if (!normalizedCookie) {
    throw new Error('登录成功但未获取到有效 cookie');
  }

  const store = resolveAccountStore(storeInput);
  const rawAccounts = store.list();

  const target = rawAccounts.find((raw) => {
    if (!raw || typeof raw !== 'object') return false;
    const account = raw as RawMusicAccount;
    return String(account.api_access_key || '').trim() === token;
  });

  if (!target || typeof target !== 'object') {
    throw new Error('账号数据库中未找到对应 api_access_key');
  }

  const account = target as RawMusicAccount;
  const storedPlatform = normalizeAccountPlatform(account.platform);
  if (storedPlatform !== session.platform) {
    throw new Error('账号数据库中账号平台与当前会话不一致');
  }
  account.cookie = normalizedCookie;
  store.update(token, { cookie: normalizedCookie });

  session.cookie = normalizedCookie;
  registry.byAccessKey.set(token, session);

  return { session, filePath: store.location };
}

/**
 * 新增扫码登录账号，并把生成好的 api_access_key、cookie、昵称同时写入
 * 账号数据库和当前进程内的账号 registry。
 */
export function createAccountWithCookie(
  apiAccessKey: string,
  platformValue: unknown,
  cookie: string,
  registry: AccountSessionRegistry,
  storeInput: AccountStoreInput = process.cwd(),
  accountName?: string
): CreateAccountResult {
  const token = String(apiAccessKey || '').trim();
  if (!token) {
    throw new Error('api_access_key 是必填参数');
  }
  if (registry.byAccessKey.has(token)) {
    throw new Error('api_access_key 已存在');
  }

  const platform = normalizeAccountPlatform(platformValue);
  const normalizedCookie = String(cookie || '').trim();
  if (!normalizedCookie) {
    throw new Error('登录成功但未获取到有效 cookie');
  }

  const store = resolveAccountStore(storeInput);
  const rawAccounts = store.list();
  const existingKeys = collectAccountKeys(registry, rawAccounts);
  if (existingKeys.has(token)) {
    throw new Error('api_access_key 已存在');
  }

  const normalizedName = String(accountName || '').trim()
    || (platform === 'qq' ? 'QQ 音乐' : '网易云音乐');
  const account: RawMusicAccount = {
    platform,
    name: normalizedName,
    cookie: normalizedCookie,
    api_access_key: token,
    stateless: false,
    useLuoxue: true,
    lxSource: []
  };
  store.insert(account);

  const session: MusicAccountSession = {
    platform,
    name: normalizedName,
    cookie: normalizedCookie,
    apiAccessKey: token,
    stateless: false,
    useLuoxue: true,
    lxSource: [],
    favoriteTrackIds: new Set<string>()
  };
  registry.sessions.push(session);
  registry.byAccessKey.set(token, session);

  return { session, filePath: store.location };
}

/** 更新网页可编辑的账号配置，不允许借此修改平台、Cookie 或访问密钥。 */
export function updateAccountConfigByAccessKey(
  apiAccessKey: string,
  input: UpdateAccountConfigInput,
  registry: AccountSessionRegistry,
  storeInput: AccountStoreInput = process.cwd()
): UpdateAccountCookieResult {
  const token = String(apiAccessKey || '').trim();
  if (!token) throw new Error('api_access_key 是必填参数');
  const session = registry.byAccessKey.get(token);
  if (!session) throw new Error('api_access_key 无效或未注册到账号数据库');

  if (typeof input.name !== 'string') throw new Error('名称必须是字符串');
  const name = input.name.trim();
  if (!name) throw new Error('名称不能为空');
  if (name.length > 100) throw new Error('名称不能超过 100 个字符');
  if (typeof input.stateless !== 'boolean') throw new Error('stateless 必须是 boolean');
  if (typeof input.useLuoxue !== 'boolean') throw new Error('useLuoxue 必须是 boolean');
  const lxSource = normalizeAccountLxSources(input.lxSource);

  const store = resolveAccountStore(storeInput);
  const rawAccounts = store.list();
  const target = rawAccounts.find((raw) => (
    raw && typeof raw === 'object' && String(raw.api_access_key || '').trim() === token
  ));
  if (!target) throw new Error('账号数据库中未找到对应 api_access_key');

  target.name = name;
  target.stateless = input.stateless;
  target.useLuoxue = input.useLuoxue;
  target.lxSource = lxSource;
  store.update(token, { name, stateless: input.stateless, useLuoxue: input.useLuoxue, lxSource });

  session.name = name;
  session.stateless = input.stateless;
  session.useLuoxue = input.useLuoxue;
  session.lxSource = lxSource;
  return { session, filePath: store.location };
}
