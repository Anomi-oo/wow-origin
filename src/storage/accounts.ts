import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import type { RawMusicAccount } from '../accounts';

export interface AccountStore {
  readonly location: string;
  list(): RawMusicAccount[];
  insert(account: RawMusicAccount): void;
  delete(apiAccessKey: string): void;
  update(apiAccessKey: string, changes: Partial<RawMusicAccount>): void;
}

type StoredAccountRow = {
  id: number;
  platform: string | null;
  name: string | null;
  cookie: string | null;
  api_access_key: string | null;
  stateless: string | null;
  use_luoxue: string | null;
  lx_source: string | null;
  device_id: string | null;
  device_state: string | null;
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
    deviceId TEXT,
    device_state TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS accounts_access_key_idx ON accounts(api_access_key);
  PRAGMA user_version = 2;
`;

function encode(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

function decode(value: string | null): unknown {
  if (value === null) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function accountValues(account: RawMusicAccount): Array<string | null> {
  return [
    encode(account.platform),
    encode(account.name),
    encode(account.cookie),
    typeof account.api_access_key === 'string'
      ? account.api_access_key
      : account.api_access_key === undefined
        ? null
        : String(account.api_access_key),
    encode(account.stateless),
    encode(account.useLuoxue),
    encode(account.lxSource),
    encode(account.deviceId),
    encode(account.deviceState)
  ];
}

function rowToAccount(row: StoredAccountRow): RawMusicAccount {
  return {
    platform: decode(row.platform),
    name: decode(row.name),
    cookie: decode(row.cookie),
    api_access_key: row.api_access_key ?? undefined,
    stateless: decode(row.stateless),
    useLuoxue: decode(row.use_luoxue),
    lxSource: decode(row.lx_source),
    deviceId: decode(row.device_id),
    deviceState: decode(row.device_state)
  };
}

export function sqliteAccountsFilePath(workDir: string = process.cwd()): string {
  return path.join(workDir, 'data', 'data.db');
}

function migrateLegacySqliteFile(workDir: string, destination: string): void {
  if (fs.existsSync(destination)) return;
  const legacy = path.join(workDir, 'data', 'wow-origin.sqlite');
  if (!fs.existsSync(legacy)) return;

  for (const suffix of ['-wal', '-shm']) {
    const source = `${legacy}${suffix}`;
    if (fs.existsSync(source)) fs.renameSync(source, `${destination}${suffix}`);
  }
  fs.renameSync(legacy, destination);
}

export class SqliteAccountStore implements AccountStore {
  readonly location: string;
  private readonly database: DatabaseSync;
  private readonly insertStatement: StatementSync;

  constructor(workDir: string = process.cwd()) {
    this.location = sqliteAccountsFilePath(workDir);
    fs.mkdirSync(path.dirname(this.location), { recursive: true });
    migrateLegacySqliteFile(workDir, this.location);
    this.database = new DatabaseSync(this.location);
    this.database.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    this.database.exec(SCHEMA);
    const columns = this.database.prepare('PRAGMA table_info(accounts)').all() as Array<{ name: string }>;
    if (!columns.some(column => column.name === 'deviceId')) this.database.exec('ALTER TABLE accounts ADD COLUMN deviceId TEXT');
    if (!columns.some(column => column.name === 'device_state')) this.database.exec('ALTER TABLE accounts ADD COLUMN device_state TEXT');
    this.insertStatement = this.database.prepare(`
      INSERT INTO accounts (
        platform, name, cookie, api_access_key, stateless, use_luoxue, lx_source, deviceId, device_state
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.database.exec('CREATE TABLE IF NOT EXISTS account_migrations (name TEXT PRIMARY KEY)');
    if (!this.database.prepare('SELECT name FROM account_migrations WHERE name = ?').get('legacy-json')) {
      this.migrateLegacyAccounts(workDir);
      this.database.prepare('INSERT INTO account_migrations (name) VALUES (?)').run('legacy-json');
    }
    fs.rmSync(path.join(workDir, 'data', 'accounts.json'), { force: true });
  }

  list(): RawMusicAccount[] {
    const rows = this.database.prepare(`
      SELECT id, platform, name, cookie, api_access_key, stateless, use_luoxue, lx_source, deviceId AS device_id, device_state
      FROM accounts
      ORDER BY id ASC
    `).all() as unknown as StoredAccountRow[];
    return rows.map(rowToAccount);
  }

  insert(account: RawMusicAccount): void {
    this.insertStatement.run(...accountValues(account));
  }

  update(apiAccessKey: string, changes: Partial<RawMusicAccount>): void {
    const row = this.database.prepare(`
      SELECT id, platform, name, cookie, api_access_key, stateless, use_luoxue, lx_source, deviceId AS device_id, device_state
      FROM accounts
      WHERE api_access_key = ?
      ORDER BY id ASC
      LIMIT 1
    `).get(apiAccessKey) as unknown as StoredAccountRow | undefined;
    if (!row) throw new Error('SQLite 中未找到对应 api_access_key');

    const account = { ...rowToAccount(row), ...changes, api_access_key: apiAccessKey };
    this.database.prepare(`
      UPDATE accounts
      SET platform = ?, name = ?, cookie = ?, api_access_key = ?, stateless = ?,
          use_luoxue = ?, lx_source = ?, deviceId = ?, device_state = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(...accountValues(account), row.id);
  }

  delete(apiAccessKey: string): void {
    this.database.prepare('DELETE FROM accounts WHERE api_access_key = ?').run(apiAccessKey);
  }

  close(): void {
    this.database.close();
  }

  private migrateLegacyAccounts(workDir: string): void {
    const count = Number((this.database.prepare('SELECT COUNT(*) AS count FROM accounts').get() as { count: number }).count);
    if (count > 0) return;

    const legacyPath = path.join(workDir, 'data', 'accounts.json');
    if (!fs.existsSync(legacyPath)) return;
    const content = fs.readFileSync(legacyPath, 'utf8');
    if (!content.trim()) return;

    let accounts: unknown;
    try {
      accounts = JSON.parse(content);
    } catch (error) {
      console.error(`[accounts] JSON 迁移失败: ${legacyPath}`, error);
      throw new Error(`旧账号文件迁移失败: ${legacyPath}`, { cause: error });
    }
    if (!Array.isArray(accounts)) {
      throw new Error(`accounts.json 必须是数组: ${legacyPath}`);
    }

    this.database.exec('BEGIN IMMEDIATE');
    try {
      accounts.forEach((account) => {
        if (account && typeof account === 'object') {
          this.insert(account as RawMusicAccount);
        }
      });
      this.database.exec('COMMIT');
      console.log(`[accounts] 已将 ${accounts.length} 条旧账号配置迁移到 SQLite`);
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}

export function createLocalAccountStore(workDir: string = process.cwd()): SqliteAccountStore {
  return new SqliteAccountStore(workDir);
}
