import type { RawMusicAccount } from '../accounts';

export type StoredAccountRow = Record<string, unknown> & { id: number };

export const ACCOUNT_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform TEXT,
    name TEXT,
    cookie TEXT,
    api_access_key TEXT,
    stateless INTEGER,
    use_luoxue INTEGER,
    lx_source TEXT,
    deviceId TEXT,
    device_state TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS accounts_access_key_idx ON accounts(api_access_key);
  CREATE TABLE IF NOT EXISTS account_migrations (name TEXT PRIMARY KEY);
`;

export const SCALAR_ACCOUNT_MIGRATION = 'scalar-columns-v1';

// Decode old JSON strings only during migration. Future text values may contain
// literal quotes or look like JSON and must survive reads and restarts verbatim.
export const MIGRATE_ACCOUNT_SCALARS_SQL = `
  UPDATE accounts SET
    ${['platform', 'name', 'cookie', 'deviceId', 'device_state'].map(column => `
      ${column} = CASE WHEN json_valid(${column}) THEN
        CASE WHEN json_type(${column}) IN ('text', 'null') THEN json_extract(${column}, '$') ELSE ${column} END
        ELSE ${column} END
    `).join(',')},
    stateless = CASE stateless WHEN 'true' THEN 1 WHEN 'false' THEN 0 ELSE stateless END,
    use_luoxue = CASE use_luoxue WHEN 'true' THEN 1 WHEN 'false' THEN 0 ELSE use_luoxue END
`;

function text(value: unknown): string | null {
  return value === undefined || value === null ? null : String(value);
}

function booleanValue(value: unknown): string | null {
  // Binding text also keeps old TEXT columns at 0/1: numeric JS bindings would
  // otherwise be stored as "0.0"/"1.0" there. INTEGER columns apply affinity.
  return typeof value === 'boolean' ? (value ? '1' : '0') : text(value);
}

function readBoolean(value: unknown): unknown {
  if (value === 1 || value === '1') return true;
  if (value === 0 || value === '0') return false;
  return value ?? undefined;
}

function json(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

function readJson(value: unknown): unknown {
  if (typeof value !== 'string') return undefined;
  try { return JSON.parse(value); } catch { return undefined; }
}

export function accountValues(account: RawMusicAccount): Array<string | null> {
  return [
    text(account.platform),
    text(account.name),
    text(account.cookie),
    text(account.api_access_key),
    booleanValue(account.stateless),
    booleanValue(account.useLuoxue),
    json(account.lxSource),
    text(account.deviceId),
    text(account.deviceState)
  ];
}

export function rowToAccount(row: StoredAccountRow): RawMusicAccount {
  return {
    platform: row.platform ?? undefined,
    name: row.name ?? undefined,
    cookie: row.cookie ?? undefined,
    api_access_key: row.api_access_key ?? undefined,
    stateless: readBoolean(row.stateless),
    useLuoxue: readBoolean(row.use_luoxue),
    lxSource: readJson(row.lx_source),
    deviceId: row.device_id ?? undefined,
    deviceState: row.device_state ?? undefined
  };
}
