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

test('Cloudflare migrates existing accounts and persists Kugou liked-list state independently', () => {
  const database = new DatabaseSync(':memory:');
  database.exec(`CREATE TABLE accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, platform TEXT, name TEXT, cookie TEXT, api_access_key TEXT,
    stateless TEXT, use_luoxue TEXT, lx_source TEXT, deviceId TEXT, device_state TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  const sql = { exec(query: string, ...bindings: any[]) {
    if (/CREATE TABLE|ALTER TABLE/.test(query)) { database.exec(query); return []; }
    return database.prepare(query).all(...bindings) as Record<string, unknown>[];
  } };
  const store = new DurableObjectAccountStore(sql);
  const state = { userId: '1', likedPlaylistId: '42' };
  store.insert({ platform: 'kugou', api_access_key: 'kugou', cookie: 'userid=1', kugouState: state });
  store.insert({ platform: 'qq', api_access_key: 'qq' });
  store.update('kugou', { cookie: 'userid=1; token=new' });
  expect(new DurableObjectAccountStore(sql).list()[0].kugouState).toEqual(state);
  expect(store.list()[1].kugouState).toBeUndefined();
  store.update('kugou', { kugouState: undefined });
  expect(store.list()[0].kugouState).toBeUndefined();
  database.close();
});
