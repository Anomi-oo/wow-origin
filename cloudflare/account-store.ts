import type { RawMusicAccount } from '../src/accounts';
import type { AccountStore } from '../src/storage';

type SqlStorage = {
  exec(query: string, ...bindings: unknown[]): Iterable<Record<string, unknown>> & {
    toArray?: () => Record<string, unknown>[];
  };
};

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform TEXT,
    name TEXT,
    cookie TEXT,
    api_access_key TEXT,
    stateless TEXT,
    use_luoxue TEXT,
    lx_source TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS accounts_access_key_idx ON accounts(api_access_key);
`;

function encode(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

function decode(value: unknown): unknown {
  if (typeof value !== 'string') return undefined;
  try { return JSON.parse(value); } catch { return undefined; }
}

function values(account: RawMusicAccount): Array<string | null> {
  return [
    encode(account.platform),
    encode(account.name),
    encode(account.cookie),
    typeof account.api_access_key === 'string'
      ? account.api_access_key
      : account.api_access_key === undefined ? null : String(account.api_access_key),
    encode(account.stateless),
    encode(account.useLuoxue),
    encode(account.lxSource)
  ];
}

function rowToAccount(row: Record<string, unknown>): RawMusicAccount {
  return {
    platform: decode(row.platform),
    name: decode(row.name),
    cookie: decode(row.cookie),
    api_access_key: row.api_access_key ?? undefined,
    stateless: decode(row.stateless),
    useLuoxue: decode(row.use_luoxue),
    lxSource: decode(row.lx_source)
  };
}

function rows(cursor: ReturnType<SqlStorage['exec']>): Record<string, unknown>[] {
  return cursor.toArray ? cursor.toArray() : Array.from(cursor);
}

/** AccountStore backed by the SQLite database embedded in one Durable Object. */
export class DurableObjectAccountStore implements AccountStore {
  readonly location = 'cloudflare:durable-object-sqlite';

  constructor(private readonly sql: SqlStorage) {
    this.sql.exec(SCHEMA);
  }

  list(): RawMusicAccount[] {
    return rows(this.sql.exec(`
      SELECT id, platform, name, cookie, api_access_key, stateless, use_luoxue, lx_source
      FROM accounts ORDER BY id ASC
    `)).map(rowToAccount);
  }

  insert(account: RawMusicAccount): void {
    this.sql.exec(`
      INSERT INTO accounts (platform, name, cookie, api_access_key, stateless, use_luoxue, lx_source)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, ...values(account));
  }

  update(apiAccessKey: string, changes: Partial<RawMusicAccount>): void {
    const row = rows(this.sql.exec(`
      SELECT id, platform, name, cookie, api_access_key, stateless, use_luoxue, lx_source
      FROM accounts WHERE api_access_key = ? ORDER BY id ASC LIMIT 1
    `, apiAccessKey))[0];
    if (!row) throw new Error('Cloudflare SQLite 中未找到对应 api_access_key');
    const account = { ...rowToAccount(row), ...changes, api_access_key: apiAccessKey };
    this.sql.exec(`
      UPDATE accounts SET platform = ?, name = ?, cookie = ?, api_access_key = ?,
        stateless = ?, use_luoxue = ?, lx_source = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, ...values(account), row.id);
  }
}
