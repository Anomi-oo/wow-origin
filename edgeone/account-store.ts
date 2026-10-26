import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { getStore } from '@edgeone/pages-blob';
import type { RawMusicAccount } from '../src/accounts';
import type { AccountStore } from '../src/storage';

/** 每个账号一个 Blob 对象，多实例并发写入时不会互相覆盖。 */
export const EDGEONE_ACCOUNTS_PREFIX = 'accounts/';
/** 早期版本使用的单文档 key，只读取一次并在首次 flush 时迁移。 */
export const EDGEONE_ACCOUNTS_KEY = 'accounts.json';
export const DEFAULT_BLOB_STORE_NAME = 'wow-origin';
export const DEFAULT_EDGEONE_ACCOUNTS_FILE = path.join('data', 'edgeone-accounts.json');

const DOCUMENT_VERSION = 1;

type ReadOptions = { type?: 'text'; consistency?: 'strong' | 'eventual' };
type ListOptions = { prefix?: string; consistency?: 'strong' | 'eventual' };

/** 这里用到的 @edgeone/pages-blob Store 最小接口，测试中也可以直接伪造。 */
export interface EdgeOneBlobStore {
  get(key: string, options?: ReadOptions): Promise<string | null>;
  set(key: string, value: string, options?: { cacheControl?: string | null }): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: ListOptions): Promise<{ blobs: Array<{ key: string; etag?: string }> }>;
}

export interface EdgeOneAccountStoreOptions {
  accounts?: RawMusicAccount[];
  blob?: EdgeOneBlobStore;
  storeName?: string;
  filePath?: string;
  location?: string;
  initialDocument?: string | null;
}

function parseAccountDocument(text: string | null | undefined): RawMusicAccount[] {
  if (!text || !text.trim()) return [];
  const parsed: unknown = JSON.parse(text);
  const accounts = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { accounts?: unknown }).accounts)
      ? (parsed as { accounts: unknown[] }).accounts
      : null;
  if (!accounts) throw new Error('EdgeOne 账号 Blob 格式无效');
  return accounts.filter(
    (account): account is RawMusicAccount => Boolean(account) && typeof account === 'object' && !Array.isArray(account)
  );
}

function parseStoredAccount(text: string | null | undefined): RawMusicAccount | null {
  if (!text || !text.trim()) return null;
  const parsed: unknown = JSON.parse(text);
  const account =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'account' in (parsed as Record<string, unknown>)
      ? (parsed as { account: unknown }).account
      : parsed;
  return account && typeof account === 'object' && !Array.isArray(account) ? (account as RawMusicAccount) : null;
}

function serializeAccount(account: RawMusicAccount): string {
  return JSON.stringify({ version: DOCUMENT_VERSION, account }, null, 2);
}

function serializeAccounts(accounts: RawMusicAccount[]): string {
  return JSON.stringify({ version: DOCUMENT_VERSION, accounts }, null, 2);
}

function accountBlobKey(account: RawMusicAccount): string | null {
  const apiAccessKey = typeof account.api_access_key === 'string' ? account.api_access_key : '';
  return apiAccessKey ? `${EDGEONE_ACCOUNTS_PREFIX}${encodeURIComponent(apiAccessKey)}` : null;
}

function blobKeyForApiKey(apiAccessKey: string): string | null {
  return apiAccessKey ? `${EDGEONE_ACCOUNTS_PREFIX}${encodeURIComponent(apiAccessKey)}` : null;
}

function sameAccount(left: RawMusicAccount, right: RawMusicAccount): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function readFileAccounts(filePath: string): { accounts: RawMusicAccount[]; text: string | null } {
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    return { accounts: parseAccountDocument(text), text };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { accounts: [], text: null };
    throw error;
  }
}

/**
 * EdgeOne Cloud Functions 没有 Durable Object 那样的单实例存储。
 * 每个账号单独保存为一个 Blob 对象：不同实例同时新增/修改不同账号时不会
 * 因整份文档覆盖而丢数据。每个实例维护内存副本，写操作同步更新内存，
 * 由 app 在响应结束前调用 flush() 持久化。reload() 用于跨实例同步。
 */
export class EdgeOneAccountStore implements AccountStore {
  readonly location: string;
  private accounts: RawMusicAccount[];
  readonly blob?: EdgeOneBlobStore;
  private readonly storeName: string;
  private readonly filePath?: string;
  private dirty = false;
  private version = 0;
  private lastPersisted: string;
  private flushChain: Promise<void> = Promise.resolve();
  private pending = new Map<string, RawMusicAccount>();
  private deleted = new Set<string>();
  private knownEtags = new Map<string, string | undefined>();
  private legacyDocumentPending = false;

  constructor(options: EdgeOneAccountStoreOptions = {}) {
    this.accounts = (options.accounts ?? []).map((account) => ({ ...account }));
    this.blob = options.blob;
    this.storeName = options.storeName ?? DEFAULT_BLOB_STORE_NAME;
    this.filePath = options.blob ? undefined : options.filePath;
    this.lastPersisted = options.initialDocument ?? (this.filePath ? this.readInitialFile() : null) ?? '';
    this.location =
      options.location ??
      (this.blob
        ? `blob://${this.storeName}/${EDGEONE_ACCOUNTS_PREFIX}`
        : (this.filePath ?? 'memory://edgeone-accounts'));
  }

  static async open(
    options: {
      blob?: EdgeOneBlobStore;
      storeName?: string;
      filePath?: string;
    } = {}
  ): Promise<EdgeOneAccountStore> {
    const storeName = options.storeName || process.env.EDGEONE_BLOB_STORE || DEFAULT_BLOB_STORE_NAME;
    const filePath =
      options.filePath ?? process.env.EDGEONE_ACCOUNTS_FILE ?? path.join(process.cwd(), DEFAULT_EDGEONE_ACCOUNTS_FILE);

    let blob = options.blob;
    if (!blob) {
      try {
        blob = getStore(storeName) as unknown as EdgeOneBlobStore;
      } catch (error) {
        if (process.env.EDGEONE_REQUIRE_BLOB === '1') throw error;
        console.warn('[edgeone] Blob 不可用，账号将使用本地文件/内存存储', error);
      }
    }

    if (blob) {
      try {
        const listed = await blob.list({
          prefix: EDGEONE_ACCOUNTS_PREFIX,
          consistency: 'strong'
        });
        const accounts: RawMusicAccount[] = [];
        const knownEtags = new Map<string, string | undefined>();
        for (const { key, etag } of listed.blobs) {
          if (!key.startsWith(EDGEONE_ACCOUNTS_PREFIX)) continue;
          let text: string | null;
          try {
            text = await blob.get(key, { type: 'text', consistency: 'strong' });
          } catch (error) {
            // 单个对象读取失败不应让所有账号退回本地存储。
            console.warn(`[edgeone] 读取账号 Blob 失败: ${key}`, error);
            continue;
          }
          if (text === null) continue;
          const account = parseStoredAccount(text);
          if (!account) {
            console.warn(`[edgeone] 忽略无法解析的账号 Blob: ${key}`);
            continue;
          }
          accounts.push(account);
          knownEtags.set(key, etag);
        }

        let legacyDocument = false;
        if (accounts.length === 0) {
          try {
            const legacyText = await blob.get(EDGEONE_ACCOUNTS_KEY, {
              type: 'text',
              consistency: 'strong'
            });
            if (legacyText) {
              accounts.push(...parseAccountDocument(legacyText));
              legacyDocument = true;
            }
          } catch (error) {
            console.warn('[edgeone] 旧账号 Blob 文档格式无效，已忽略', error);
          }
        }

        const store = new EdgeOneAccountStore({
          accounts,
          blob,
          storeName,
          initialDocument: null
        });
        store.knownEtags = knownEtags;
        if (legacyDocument) {
          store.legacyDocumentPending = true;
          for (const account of accounts) {
            const key = accountBlobKey(account);
            if (!key) {
              console.warn('[edgeone] 旧账号 Blob 中的账号缺少 api_access_key，无法迁移');
              continue;
            }
            store.pending.set(key, account);
          }
          store.markDirty();
        }
        return store;
      } catch (error) {
        if (process.env.EDGEONE_REQUIRE_BLOB === '1') throw error;
        console.warn('[edgeone] 读取 Blob 账号失败，回退到本地文件/内存存储', error);
      }
    }

    const { accounts, text } = readFileAccounts(filePath);
    return new EdgeOneAccountStore({
      accounts,
      storeName,
      filePath,
      initialDocument: text
    });
  }

  list(): RawMusicAccount[] {
    return this.accounts.map((account) => ({
      ...account,
      ...(Array.isArray(account.lxSource) ? { lxSource: [...account.lxSource] } : {})
    }));
  }

  insert(account: RawMusicAccount): void {
    const next = { ...account };
    const key = this.blob ? accountBlobKey(next) : null;
    if (this.blob && !key) throw new Error('EdgeOne Blob 账号缺少 api_access_key');
    this.accounts.push(next);
    if (key) {
      this.pending.set(key, next);
      this.deleted.delete(key);
    }
    this.markDirty();
  }

  update(apiAccessKey: string, changes: Partial<RawMusicAccount>): void {
    const index = this.accounts.findIndex((account) => account.api_access_key === apiAccessKey);
    if (index < 0) throw new Error('EdgeOne Blob 中未找到对应 api_access_key');
    const next = {
      ...this.accounts[index],
      ...changes,
      api_access_key: apiAccessKey
    };
    this.accounts[index] = next;
    if (this.blob) {
      const key = blobKeyForApiKey(apiAccessKey);
      if (!key) throw new Error('EdgeOne Blob 账号缺少 api_access_key');
      this.pending.set(key, next);
      this.deleted.delete(key);
    }
    this.markDirty();
  }

  delete(apiAccessKey: string): void {
    const next = this.accounts.filter((account) => account.api_access_key !== apiAccessKey);
    const removed = next.length !== this.accounts.length;
    if (this.blob) {
      const key = blobKeyForApiKey(apiAccessKey);
      if (!key) throw new Error('EdgeOne Blob 账号缺少 api_access_key');
      // 即使本地副本里没有该账号，也要删除远端对象（其他实例可能刚写入）。
      this.pending.delete(key);
      this.deleted.add(key);
      this.knownEtags.delete(key);
      this.accounts = next;
      this.markDirty();
      return;
    }
    if (!removed) return;
    this.accounts = next;
    this.markDirty();
  }

  async flush(): Promise<void> {
    const run = this.flushChain.then(() => this.flushOnce());
    this.flushChain = run.catch(() => undefined);
    return run;
  }

  async reload(): Promise<boolean> {
    await this.flush();
    const version = this.version;

    if (this.blob) {
      const listed = await this.blob.list({
        prefix: EDGEONE_ACCOUNTS_PREFIX,
        consistency: 'strong'
      });
      const localByKey = new Map<string, RawMusicAccount>();
      const keyless: RawMusicAccount[] = [];
      for (const account of this.accounts) {
        const key = accountBlobKey(account);
        if (key) localByKey.set(key, account);
        else keyless.push(account);
      }

      const listedKeys = new Set<string>();
      const remote = new Map<string, RawMusicAccount>();
      const nextEtags = new Map<string, string | undefined>();
      let changed = false;

      for (const { key, etag } of listed.blobs) {
        if (!key.startsWith(EDGEONE_ACCOUNTS_PREFIX)) continue;
        listedKeys.add(key);
        const local = localByKey.get(key);
        if (local && etag !== undefined && this.knownEtags.get(key) === etag) {
          remote.set(key, local);
          nextEtags.set(key, etag);
          continue;
        }
        const text = await this.blob.get(key, { type: 'text', consistency: 'strong' });
        if (version !== this.version) return false;
        if (text === null) {
          changed = true;
          continue;
        }
        const account = parseStoredAccount(text);
        if (!account) {
          changed = true;
          continue;
        }
        if (!local || !sameAccount(local, account)) changed = true;
        remote.set(key, account);
        nextEtags.set(key, etag);
      }

      for (const key of localByKey.keys()) {
        if (!listedKeys.has(key)) {
          changed = true;
          break;
        }
      }
      if (!changed) {
        if (version === this.version) this.knownEtags = nextEtags;
        return false;
      }
      if (version !== this.version) return false;

      this.accounts = [...keyless, ...remote.values()];
      this.knownEtags = nextEtags;
      return true;
    }

    const text = await this.readDocument();
    if (version !== this.version) return false;
    const normalized = text ?? '';
    if (normalized === this.lastPersisted) return false;
    this.accounts = parseAccountDocument(text);
    this.lastPersisted = normalized;
    return true;
  }

  private markDirty(): void {
    this.dirty = true;
    this.version += 1;
  }

  private async flushOnce(): Promise<void> {
    while (this.dirty) {
      this.dirty = false;

      if (this.blob) {
        const writes = new Map(this.pending);
        const deletes = new Set(this.deleted);
        const deleteLegacy = this.legacyDocumentPending;
        if (writes.size === 0 && deletes.size === 0 && !deleteLegacy) {
          break;
        }
        this.pending.clear();
        this.deleted.clear();

        try {
          for (const [key, account] of writes) {
            await this.blob.set(key, serializeAccount(account), {
              cacheControl: 'no-store'
            });
            this.knownEtags.delete(key);
          }
          for (const key of deletes) {
            await this.blob.delete(key);
            this.knownEtags.delete(key);
          }
          if (deleteLegacy) {
            await this.blob.delete(EDGEONE_ACCOUNTS_KEY);
            this.legacyDocumentPending = false;
          }
        } catch (error) {
          for (const [key, account] of writes) {
            if (!this.pending.has(key) && !this.deleted.has(key)) {
              this.pending.set(key, account);
            }
          }
          for (const key of deletes) {
            if (!this.pending.has(key) && !this.deleted.has(key)) {
              this.deleted.add(key);
            }
          }
          this.dirty = true;
          throw error;
        }
        continue;
      }

      const serialized = serializeAccounts(this.accounts);
      try {
        if (this.filePath) {
          await fsPromises.mkdir(path.dirname(this.filePath), { recursive: true });
          const temporary = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
          await fsPromises.writeFile(temporary, serialized, 'utf8');
          await fsPromises.rename(temporary, this.filePath);
        }
        this.lastPersisted = serialized;
      } catch (error) {
        this.dirty = true;
        throw error;
      }
    }
  }

  private async readDocument(): Promise<string | null> {
    if (!this.filePath) return this.lastPersisted || null;
    try {
      return await fsPromises.readFile(this.filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  private readInitialFile(): string | null {
    if (!this.filePath) return null;
    try {
      return fs.readFileSync(this.filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }
}
