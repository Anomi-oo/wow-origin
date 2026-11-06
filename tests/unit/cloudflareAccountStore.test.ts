import { test, expect } from '@jest/globals';
import { DatabaseSync } from 'node:sqlite';
import { DurableObjectAccountStore } from '../../cloudflare/account-store';

test('Cloudflare deletion removes only the selected account from durable SQLite', () => {
  const database = new DatabaseSync(':memory:');
  const store = new DurableObjectAccountStore({ exec(query: string, ...bindings: any[]) {
    if (query.includes('CREATE TABLE')) { database.exec(query); return []; }
    return database.prepare(query).all(...bindings) as Record<string, unknown>[];
  } });
  store.insert({ platform: 'netease', api_access_key: 'first', cookie: 'secret', deviceState: 'device' });
  store.insert({ platform: 'qq', api_access_key: 'second' });
  store.delete('first');
  expect(store.list().map(account => account.api_access_key)).toEqual(['second']);
  store.delete('second');
  expect(store.list()).toEqual([]);
  database.close();
});

test('Cloudflare removes the legacy Kugou cache column while preserving accounts and credential updates', () => {
  const database = new DatabaseSync(':memory:');
  database.exec(`CREATE TABLE accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, platform TEXT, name TEXT, cookie TEXT, api_access_key TEXT,
    stateless TEXT, use_luoxue TEXT, lx_source TEXT, deviceId TEXT, device_state TEXT, kugou_state TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  database.prepare('INSERT INTO accounts (platform, api_access_key, cookie, kugou_state) VALUES (?, ?, ?, ?)')
    .run('kugou', 'kugou', 'userid=1', JSON.stringify({ userId: '1', likedPlaylistId: '42' }));
  const sql = { exec(query: string, ...bindings: any[]) {
    if (/CREATE TABLE|ALTER TABLE/.test(query)) { database.exec(query); return []; }
    return database.prepare(query).all(...bindings) as Record<string, unknown>[];
  } };
  const store = new DurableObjectAccountStore(sql);
  expect(database.prepare('PRAGMA table_info(accounts)').all().map(column => column.name)).not.toContain('kugou_state');
  store.insert({ platform: 'qq', api_access_key: 'qq' });
  store.update('kugou', { cookie: 'userid=1; token=new' });
  expect(new DurableObjectAccountStore(sql).list()[0]).toMatchObject({ platform: 'kugou', cookie: 'userid=1; token=new' });
  expect(store.list()[0]).not.toHaveProperty('kugouState');
  expect(store.list()[1]).toMatchObject({ platform: 'qq', api_access_key: 'qq' });
  database.close();
});
