import { test, expect } from '@jest/globals';
import { createEdgeOneLoginStateStores, EdgeOneBlobLoginStateStore } from '../../edgeone/login-state';
import type { EdgeOneBlobStore } from '../../edgeone/account-store';
import type { PendingLogin } from '../../src/loginState';

class MemoryBlobStore implements EdgeOneBlobStore {
  readonly values = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }

  async list(options: { prefix?: string } = {}): Promise<{ blobs: Array<{ key: string }> }> {
    return {
      blobs: [...this.values.keys()]
        .filter((key) => !options.prefix || key.startsWith(options.prefix))
        .map((key) => ({ key }))
    };
  }
}

test('EdgeOne login state survives across store instances', async () => {
  const blob = new MemoryBlobStore();
  const first = new EdgeOneBlobLoginStateStore<PendingLogin>(blob, 'login/qr/');
  const pending: PendingLogin = {
    mode: 'create',
    apiAccessKey: 'key-1',
    platform: 'netease',
    createdAt: Date.now()
  };
  await first.set('qr-token', pending);

  const second = new EdgeOneBlobLoginStateStore<PendingLogin>(blob, 'login/qr/');
  expect(await second.get('qr-token')).toEqual(pending);
  expect(await second.entries()).toEqual([['qr-token', pending]]);

  await second.delete('qr-token');
  expect(await first.get('qr-token')).toBeUndefined();
});

test('EdgeOne login state factory uses Blob stores when available', async () => {
  const blob = new MemoryBlobStore();
  const stores = createEdgeOneLoginStateStores(blob);
  await stores.qr.set('token', {
    mode: 'create',
    apiAccessKey: 'key',
    platform: 'qq',
    createdAt: Date.now()
  });
  expect(blob.values.has('login/qr/token')).toBe(true);
});

test('EdgeOne login state encodes tokens and rejects non-ASCII keys', async () => {
  const blob = new MemoryBlobStore();
  const store = new EdgeOneBlobLoginStateStore<PendingLogin>(blob, 'login/qr/');
  const pending: PendingLogin = {
    mode: 'create',
    apiAccessKey: 'key',
    platform: 'qq',
    createdAt: Date.now()
  };
  await store.set('a/b', pending);
  expect(blob.values.has('login/qr/a%2Fb')).toBe(true);
  expect(await store.get('a/b')).toEqual(pending);

  await expect(store.set('中文 token', pending)).rejects.toThrow('登录 token 无效');
  expect(await store.get('中文 token')).toBeUndefined();
});

test('EdgeOne login state cleanup removes only expired entries', async () => {
  const blob = new MemoryBlobStore();
  const stores = createEdgeOneLoginStateStores(blob);
  const base = { mode: 'create' as const, apiAccessKey: 'key', platform: 'netease' as const };
  await stores.qr.set('expired', { ...base, createdAt: Date.now() - 181_000 });
  await stores.qr.set('fresh', { ...base, createdAt: Date.now() });
  await stores.phone.set('expired-phone', { ...base, createdAt: Date.now() - 601_000 });
  await stores.phone.set('fresh-phone', { ...base, createdAt: Date.now() });

  await stores.cleanup?.();

  expect(blob.values.has('login/qr/expired')).toBe(false);
  expect(blob.values.has('login/qr/fresh')).toBe(true);
  expect(blob.values.has('login/phone/expired-phone')).toBe(false);
  expect(blob.values.has('login/phone/fresh-phone')).toBe(true);
});
