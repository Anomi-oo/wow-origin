import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { MusicPlatform } from './types';

export interface RawMusicAccount {
  platform?: unknown;
  name?: unknown;
  cookie?: unknown;
  api_access_key?: unknown;
  stateless?: unknown;
  needUnlock?: unknown;
}

export interface MusicAccountSession {
  platform: MusicPlatform;
  name: string;
  cookie: string;
  apiAccessKey: string;
  stateless: boolean;
  needUnlock: boolean;
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

export const sessionsTemplate: RawMusicAccount[] = [
  {
    platform: 'qq',
    name: 'QQ 音乐1',
    cookie: '',
    api_access_key: '',
    stateless: false,
    needUnlock: true
  },
  {
    platform: 'qq',
    name: 'QQ 音乐',
    cookie: '',
    api_access_key: '',
    stateless: false,
    needUnlock: true
  },
  {
    platform: 'netease',
    name: '网易云音乐',
    cookie: '',
    api_access_key: '',
    stateless: false,
    needUnlock: true
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

function normalizeAccountNeedUnlock(value: unknown): { value: boolean; invalid: boolean } {
  if (value === undefined) return { value: true, invalid: false };
  if (typeof value === 'boolean') return { value, invalid: false };
  return { value: false, invalid: true };
}

function printTemplate(): void {
  console.log('[accounts] accounts.json 配置模板:');
  console.log(JSON.stringify(sessionsTemplate, null, 2));
}

export function accountsFilePath(workDir: string = process.cwd()): string {
  return path.join(workDir, 'data', 'accounts.json');
}

function readRawAccountsForWrite(workDir: string, allowMissing: boolean = false): { filePath: string; rawAccounts: RawMusicAccount[] } {
  const filePath = accountsFilePath(workDir);

  if (!fs.existsSync(filePath)) {
    if (!allowMissing) {
      throw new Error('accounts.json 不存在');
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    return { filePath, rawAccounts: [] };
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const rawAccounts: unknown = content.trim() ? JSON.parse(content) : [];
  if (!Array.isArray(rawAccounts)) {
    throw new Error('accounts.json 必须是数组');
  }

  return { filePath, rawAccounts: rawAccounts as RawMusicAccount[] };
}

function writeRawAccounts(filePath: string, rawAccounts: RawMusicAccount[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempFilePath = `${filePath}.tmp`;
  fs.writeFileSync(tempFilePath, `${JSON.stringify(rawAccounts, null, 2)}\n`, 'utf8');
  fs.renameSync(tempFilePath, filePath);
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
  workDir: string = process.cwd()
): string {
  const { rawAccounts } = readRawAccountsForWrite(workDir, true);
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
export function loadAccountSessions(workDir: string = process.cwd()): AccountSessionRegistry {
  const filePath = accountsFilePath(workDir);
  const emptyRegistry: AccountSessionRegistry = { sessions: [], byAccessKey: new Map() };

  if (!fs.existsSync(filePath)) {
    console.error(`[accounts] accounts.json 不存在: ${filePath}`);
    printTemplate();
    return emptyRegistry;
  }

  let content = '';
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    console.error(`[accounts] 读取 accounts.json 失败: ${filePath}`, error);
    printTemplate();
    return emptyRegistry;
  }

  if (!content.trim()) {
    console.error(`[accounts] accounts.json 内容为空: ${filePath}`);
    printTemplate();
    return emptyRegistry;
  }

  let rawAccounts: unknown;
  try {
    rawAccounts = JSON.parse(content);
  } catch (error) {
    console.error(`[accounts] accounts.json JSON 解析失败: ${filePath}`, error);
    printTemplate();
    return emptyRegistry;
  }

  if (!Array.isArray(rawAccounts)) {
    console.error(`[accounts] accounts.json 必须是数组: ${filePath}`);
    printTemplate();
    return emptyRegistry;
  }

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
      const stateless = normalizeAccountStateless(account.stateless);
      const needUnlock = normalizeAccountNeedUnlock(account.needUnlock);
      if (needUnlock.invalid) {
        console.warn(
          `[accounts] 账号 "${String(account.name || `${platform}-${index + 1}`).trim()}" 的 needUnlock 必须是 boolean，已按 false 处理`
        );
      }
      parsedSessions.push({
        platform,
        name: String(account.name || `${platform}-${index + 1}`).trim(),
        cookie: String(account.cookie || ''),
        apiAccessKey,
        stateless,
        needUnlock: needUnlock.value,
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
 * 登录入口依赖这个函数把扫码结果持久化到 data/accounts.json。
 */
export function updateAccountCookieByAccessKey(
  apiAccessKey: string,
  platformValue: unknown,
  cookie: string,
  registry: AccountSessionRegistry,
  workDir: string = process.cwd(),
  accountName?: string
): UpdateAccountCookieResult {
  const token = String(apiAccessKey || '').trim();
  if (!token) {
    throw new Error('api_access_key 是必填参数');
  }

  const platform = normalizeAccountPlatform(platformValue);
  const session = registry.byAccessKey.get(token);
  if (!session) {
    throw new Error('api_access_key 无效或未注册到 accounts.json');
  }

  const normalizedCookie = String(cookie || '').trim();
  if (!normalizedCookie) {
    throw new Error('登录成功但未获取到有效 cookie');
  }

  const { filePath, rawAccounts } = readRawAccountsForWrite(workDir);

  const target = rawAccounts.find((raw) => {
    if (!raw || typeof raw !== 'object') return false;
    const account = raw as RawMusicAccount;
    return String(account.api_access_key || '').trim() === token;
  });

  if (!target || typeof target !== 'object') {
    throw new Error('accounts.json 中未找到对应 api_access_key');
  }

  const account = target as RawMusicAccount;
  const normalizedName = String(accountName || '').trim();
  account.platform = platform;
  account.cookie = normalizedCookie;
  if (normalizedName) {
    account.name = normalizedName;
  }

  writeRawAccounts(filePath, rawAccounts);

  session.platform = platform;
  session.cookie = normalizedCookie;
  if (normalizedName) {
    session.name = normalizedName;
  }
  registry.byAccessKey.set(token, session);

  return { session, filePath };
}

/**
 * 新增扫码登录账号，并把生成好的 api_access_key、cookie、昵称同时写入
 * data/accounts.json 和当前进程内的账号 registry。
 */
export function createAccountWithCookie(
  apiAccessKey: string,
  platformValue: unknown,
  cookie: string,
  registry: AccountSessionRegistry,
  workDir: string = process.cwd(),
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

  const { filePath, rawAccounts } = readRawAccountsForWrite(workDir, true);
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
    needUnlock: true
  };
  rawAccounts.push(account);
  writeRawAccounts(filePath, rawAccounts);

  const session: MusicAccountSession = {
    platform,
    name: normalizedName,
    cookie: normalizedCookie,
    apiAccessKey: token,
    stateless: false,
    needUnlock: true,
    favoriteTrackIds: new Set<string>()
  };
  registry.sessions.push(session);
  registry.byAccessKey.set(token, session);

  return { session, filePath };
}
