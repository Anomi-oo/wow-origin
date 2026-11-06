import type { RawMusicAccount } from '../src/accounts';
import type { AccountStore } from '../src/storage';
import {
  ACCOUNT_SCHEMA_SQL, SCALAR_ACCOUNT_MIGRATION, MIGRATE_ACCOUNT_SCALARS_SQL,
  accountValues, rowToAccount, type StoredAccountRow
} from '../src/storage/sqliteAccountSchema';

type SqlStorage = {
  exec(query: string, ...bindings: unknown[]): Iterable<Record<string, unknown>> & {
    toArray?: () => Record<string, unknown>[];
  };
};

function rows(cursor: ReturnType<SqlStorage['exec']>): StoredAccountRow[] {
  return (cursor.toArray ? cursor.toArray() : Array.from(cursor)) as StoredAccountRow[];
}

/** AccountStore backed by the SQLite database embedded in one Durable Object. */
export class DurableObjectAccountStore implements AccountStore {
  readonly location = 'cloudflare:durable-object-sqlite';

  constructor(private readonly sql: SqlStorage) {
    this.sql.exec(ACCOUNT_SCHEMA_SQL);
    const columns = rows(this.sql.exec('PRAGMA table_info(accounts)'));
    if (!columns.some(column => column.name === 'deviceId')) this.sql.exec('ALTER TABLE accounts ADD COLUMN deviceId TEXT');
    if (!columns.some(column => column.name === 'device_state')) this.sql.exec('ALTER TABLE accounts ADD COLUMN device_state TEXT');
    if (columns.some(column => column.name === 'kugou_state')) this.sql.exec('ALTER TABLE accounts DROP COLUMN kugou_state');
    if (!rows(this.sql.exec('SELECT name FROM account_migrations WHERE name = ?', SCALAR_ACCOUNT_MIGRATION)).length) {
      this.sql.exec(MIGRATE_ACCOUNT_SCALARS_SQL);
      this.sql.exec('INSERT INTO account_migrations (name) VALUES (?)', SCALAR_ACCOUNT_MIGRATION);
    }
  }

  list(): RawMusicAccount[] {
    return rows(this.sql.exec(`
      SELECT id, platform, name, cookie, api_access_key, stateless, use_luoxue, lx_source, deviceId AS device_id, device_state
      FROM accounts ORDER BY id ASC
    `)).map(rowToAccount);
  }

  insert(account: RawMusicAccount): void {
    this.sql.exec(`
      INSERT INTO accounts (platform, name, cookie, api_access_key, stateless, use_luoxue, lx_source, deviceId, device_state)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, ...accountValues(account));
  }

  delete(apiAccessKey: string): void {
    this.sql.exec('DELETE FROM accounts WHERE api_access_key = ?', apiAccessKey);
  }

  update(apiAccessKey: string, changes: Partial<RawMusicAccount>): void {
    const row = rows(this.sql.exec(`
      SELECT id, platform, name, cookie, api_access_key, stateless, use_luoxue, lx_source, deviceId AS device_id, device_state
      FROM accounts WHERE api_access_key = ? ORDER BY id ASC LIMIT 1
    `, apiAccessKey))[0];
    if (!row) throw new Error('Cloudflare SQLite 中未找到对应 api_access_key');
    const account = { ...rowToAccount(row), ...changes, api_access_key: apiAccessKey };
    this.sql.exec(`
      UPDATE accounts SET platform = ?, name = ?, cookie = ?, api_access_key = ?,
        stateless = ?, use_luoxue = ?, lx_source = ?, deviceId = ?, device_state = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, ...accountValues(account), row.id);
  }
}
