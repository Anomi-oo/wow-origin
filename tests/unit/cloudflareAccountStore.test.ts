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
