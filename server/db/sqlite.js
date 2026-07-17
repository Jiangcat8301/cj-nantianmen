import Database from 'better-sqlite3'
import { Database as IDatabase } from './interface.js'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS providers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  protocol TEXT NOT NULL CHECK(protocol IN ('openai','anthropic')),
  base_url TEXT NOT NULL,
  api_key TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS models (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id INTEGER NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  model_name TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  is_manual INTEGER NOT NULL DEFAULT 0,
  deleted INTEGER NOT NULL DEFAULT 0,
  is_disabled INTEGER NOT NULL DEFAULT 0,
  input_price REAL NOT NULL DEFAULT 0,
  output_price REAL NOT NULL DEFAULT 0,
  cache_hit_price REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(provider_id, model_name)
);
CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT
);
CREATE TABLE IF NOT EXISTS usage_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  api_key_id INTEGER REFERENCES api_keys(id) ON DELETE SET NULL,
  provider_id INTEGER REFERENCES providers(id) ON DELETE SET NULL,
  model_name TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 1,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cached_tokens INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS communication_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL,
  time TEXT NOT NULL,
  user_id TEXT NOT NULL DEFAULT '',
  user_name TEXT NOT NULL DEFAULT '',
  provider_id INTEGER NOT NULL,
  provider_name TEXT NOT NULL DEFAULT '',
  model_name TEXT NOT NULL DEFAULT '',
  tokens_input INTEGER NOT NULL DEFAULT 0,
  tokens_output INTEGER NOT NULL DEFAULT 0,
  tokens_cached INTEGER NOT NULL DEFAULT 0,
  input TEXT NOT NULL DEFAULT '',
  output TEXT NOT NULL DEFAULT '',
  error_code INTEGER,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_commlog_time ON communication_log(time DESC);
`

export class SqliteDatabase extends IDatabase {
  constructor(path) {
    super()
    this.path = path
    this.db = new Database(path)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.db.exec(SCHEMA)
    // ponytail: migrate existing DBs — add columns if missing (ignore "duplicate column" errors).
    for (const col of ['deleted','is_disabled','input_price','output_price','cache_hit_price']) {
      try { this.db.exec(`ALTER TABLE models ADD COLUMN ${col} INTEGER NOT NULL DEFAULT 0`) } catch {}
    }
  }
  // better-sqlite3 is sync; we expose async to match the interface.
  async query(sql, params = []) { return this.db.prepare(sql).all(...params) }
  async run(sql, params = []) {
    const info = this.db.prepare(sql).run(...params)
    return { changes: info.changes, lastInsertRowid: Number(info.lastInsertRowid) }
  }
  async exec(sql) { this.db.exec(sql) }
  async begin() { this.db.exec('BEGIN') }
  async commit() { this.db.exec('COMMIT') }
  async rollback() { this.db.exec('ROLLBACK') }
  async close() { this.db.close() }
}
