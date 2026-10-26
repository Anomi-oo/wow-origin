import type { LoginStateStore, LoginStateStores, PendingLogin, PendingPhone } from '../src/loginState';
import { createMemoryLoginStateStores, PHONE_LOGIN_TTL_MS, QR_LOGIN_TTL_MS } from '../src/loginState';
import type { EdgeOneBlobStore } from './account-store';

export const EDGEONE_QR_LOGIN_PREFIX = 'login/qr/';
export const EDGEONE_PHONE_LOGIN_PREFIX = 'login/phone/';

function blobKey(prefix: string, token: string): string {
  return `${prefix}${encodeURIComponent(token)}`;
}

function usableToken(token: string): boolean {
  return /^[\x21-\x7E]{1,256}$/.test(token) && encodeURIComponent(token).length <= 500;
}

/** 扫码/手机登录的临时状态写入 Blob，避免 Cloud Functions 多实例间丢状态。 */
export class EdgeOneBlobLoginStateStore<T extends { createdAt: number }> implements LoginStateStore<T> {
  constructor(
    private readonly blob: EdgeOneBlobStore,
    private readonly prefix: string
  ) {}

  async get(token: string): Promise<T | undefined> {
    if (!usableToken(token)) return undefined;
    const key = blobKey(this.prefix, token);
    const text = await this.blob.get(key, { type: 'text', consistency: 'strong' });
    if (text === null) return undefined;
    try {
      const value = JSON.parse(text) as T;
      return value && typeof value === 'object' && typeof value.createdAt === 'number' ? value : undefined;
    } catch {
      await this.blob.delete(key).catch(() => undefined);
      return undefined;
    }
  }

  async set(token: string, value: T): Promise<void> {
    if (!usableToken(token)) throw new Error('登录 token 无效');
    await this.blob.set(blobKey(this.prefix, token), JSON.stringify(value), {
      cacheControl: 'no-store'
    });
  }

  async delete(token: string): Promise<void> {
    if (!usableToken(token)) return;
    await this.blob.delete(blobKey(this.prefix, token));
  }

  async entries(): Promise<Array<[string, T]>> {
    const { blobs } = await this.blob.list({
      prefix: this.prefix,
      consistency: 'strong'
    });
    const entries: Array<[string, T]> = [];
    for (const { key } of blobs) {
      if (!key.startsWith(this.prefix)) continue;
      let token: string;
      try {
        token = decodeURIComponent(key.slice(this.prefix.length));
      } catch {
        continue;
      }
      const value = await this.get(token);
      if (value) entries.push([token, value]);
    }
    return entries;
  }

  async cleanup(maxAgeMs: number, now: number = Date.now()): Promise<void> {
    // 过期条目只会在用户主动查询时被判定失效，需要定期删除避免 Blob 累积。
    const entries = await this.entries();
    await Promise.all(
      entries.filter(([, value]) => now - value.createdAt > maxAgeMs).map(([token]) => this.delete(token))
    );
  }
}

export function createEdgeOneLoginStateStores(blob?: EdgeOneBlobStore): LoginStateStores {
  if (!blob) return createMemoryLoginStateStores();
  const qr = new EdgeOneBlobLoginStateStore<PendingLogin>(blob, EDGEONE_QR_LOGIN_PREFIX);
  const phone = new EdgeOneBlobLoginStateStore<PendingPhone>(blob, EDGEONE_PHONE_LOGIN_PREFIX);
  let lastCleanupAt = 0;
  let cleanupInFlight: Promise<void> | undefined;
  return {
    qr,
    phone,
    cleanup() {
      // 每个实例最多每 10 分钟清理一次，避免每次登录请求都列出 Blob。
      if (cleanupInFlight || Date.now() - lastCleanupAt < 10 * 60_000) return cleanupInFlight;
      lastCleanupAt = Date.now();
      cleanupInFlight = Promise.all([qr.cleanup(QR_LOGIN_TTL_MS), phone.cleanup(PHONE_LOGIN_TTL_MS)])
        .then(() => undefined)
        .finally(() => {
          cleanupInFlight = undefined;
        });
      return cleanupInFlight;
    }
  };
}
