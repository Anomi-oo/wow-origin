import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from '@jest/globals';
import { EdgeOneAccountStore, type EdgeOneBlobStore } from '../../edgeone/account-store';

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

  async list(options: { prefix?: string } = {}): Promise<{ blobs: Array<{ key: string; etag: string }> }> {
    return {
      blobs: [...this.values.entries()]
        .filter(([key]) => !options.prefix || key.startsWith(options.prefix))
        .map(([key, value]) => ({ key, etag: value }))
    };
  }
}

test('EdgeOne Blob account store persists insert/update/delete across instances', async () => {
  const blob = new MemoryBlobStore();
  const first = await EdgeOneAccountStore.open({ blob });
  first.insert({
    platform: 'netease',
    name: '网易云',
    cookie: 'MUSIC_U=old',
    api_access_key: 'key-1',
    stateless: false,
    useLuoxue: true,
    lxSource: ['https://example.com/source.js']
  });
  await first.flush();

  const second = await EdgeOneAccountStore.open({ blob });
  expect(second.list()).toEqual([
    expect.objectContaining({
      platform: 'netease',
      api_access_key: 'key-1',
      cookie: 'MUSIC_U=old'
    })
  ]);

  second.update('key-1', { cookie: 'MUSIC_U=new' });
  await second.flush();

  const third = await EdgeOneAccountStore.open({ blob });
  expect(third.list()[0]).toMatchObject({ cookie: 'MUSIC_U=new' });

  third.delete('key-1');
  await third.flush();
  expect((await EdgeOneAccountStore.open({ blob })).list()).toEqual([]);
});

test('EdgeOne account reload reports whether the shared document changed', async () => {
  const blob = new MemoryBlobStore();
  const local = await EdgeOneAccountStore.open({ blob });
  expect(await local.reload()).toBe(false);

  const remote = await EdgeOneAccountStore.open({ blob });
  remote.insert({ platform: 'qq', api_access_key: 'remote-key', cookie: 'uin=1' });
  await remote.flush();

  expect(await local.reload()).toBe(true);
  expect(local.list().map((account) => account.api_access_key)).toEqual(['remote-key']);
});

test('EdgeOne Blob account store keeps concurrent writes to different accounts', async () => {
  const blob = new MemoryBlobStore();
  const first = await EdgeOneAccountStore.open({ blob });
  const second = await EdgeOneAccountStore.open({ blob });

  first.insert({ platform: 'netease', api_access_key: 'key-a', cookie: 'MUSIC_U=a' });
  second.insert({ platform: 'qq', api_access_key: 'key-b', cookie: 'uin=2' });
  await first.flush();
  await second.flush();

  const reopened = await EdgeOneAccountStore.open({ blob });
  expect(
    reopened
      .list()
      .map((account) => account.api_access_key)
      .sort()
  ).toEqual(['key-a', 'key-b']);
});

test('EdgeOne account store migrates the legacy single Blob document', async () => {
  const blob = new MemoryBlobStore();
  blob.values.set(
    'accounts.json',
    JSON.stringify({
      version: 1,
      accounts: [{ platform: 'netease', api_access_key: 'legacy-key', cookie: 'MUSIC_U=x' }]
    })
  );

  const store = await EdgeOneAccountStore.open({ blob });
  expect(store.list().map((account) => account.api_access_key)).toEqual(['legacy-key']);

  await store.flush();
  expect(blob.values.has('accounts.json')).toBe(false);
  expect([...blob.values.keys()]).toEqual(['accounts/legacy-key']);
});

test('EdgeOne account store falls back to an atomic JSON file without Blob', async () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wow-edgeone-account-'));
  const filePath = path.join(workDir, 'data', 'edgeone-accounts.json');
  const store = new EdgeOneAccountStore({ accounts: [], filePath });
  store.insert({ platform: 'netease', api_access_key: 'file-key', cookie: 'MUSIC_U=x' });
  await store.flush();

  const saved = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  expect(saved).toMatchObject({
    version: 1,
    accounts: [expect.objectContaining({ api_access_key: 'file-key' })]
  });

  const reopened = new EdgeOneAccountStore({ accounts: saved.accounts, filePath });
  expect(reopened.list()).toHaveLength(1);
});
