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
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT DEFAULT NULL
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
  deleted_at TEXT DEFAULT NULL,
  UNIQUE(provider_id, model_name)
);
CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT,
  assigned_model TEXT DEFAULT NULL,
  assigned_model_id INTEGER DEFAULT NULL REFERENCES models(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS api_key_models (
  api_key_id INTEGER NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  model_id INTEGER NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  PRIMARY KEY (api_key_id, model_id)
);
CREATE INDEX IF NOT EXISTS idx_api_key_models_key ON api_key_models(api_key_id);
CREATE TABLE IF NOT EXISTS usage_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  api_key_id INTEGER REFERENCES api_keys(id) ON DELETE SET NULL,
  provider_id INTEGER REFERENCES providers(id) ON DELETE SET NULL,
  model_id INTEGER REFERENCES models(id) ON DELETE SET NULL,
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
  model_id INTEGER REFERENCES models(id) ON DELETE SET NULL,
  model_name TEXT NOT NULL DEFAULT '',
  tokens_input INTEGER NOT NULL DEFAULT 0,
  tokens_output INTEGER NOT NULL DEFAULT 0,
  tokens_cached INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER DEFAULT NULL,
  input TEXT NOT NULL DEFAULT '',
  output TEXT NOT NULL DEFAULT '',
  error_code INTEGER,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_commlog_time ON communication_log(time DESC);
CREATE INDEX IF NOT EXISTS idx_usage_stats_model_id ON usage_stats(model_id);
CREATE INDEX IF NOT EXISTS idx_commlog_model_id ON communication_log(model_id);
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
    // ponytail: api_keys.assigned_model — when set, every llm request from this key uses this model
    // regardless of the requested model name (admin override).
    try { this.db.exec(`ALTER TABLE api_keys ADD COLUMN assigned_model TEXT DEFAULT NULL`) } catch {}
    // ponytail: communication_log.duration_ms — total wall time from request arrival to response
    try { this.db.exec(`ALTER TABLE communication_log ADD COLUMN duration_ms INTEGER DEFAULT NULL`) } catch {}
    // ponytail: v0.2.14 — model_id 化 + 软删除 + api_key 授权表
    // 软删除字段: 软删后 is_default/deleted 仍生效, JOIN 拿历史名
    try { this.db.exec(`ALTER TABLE providers ADD COLUMN deleted_at TEXT DEFAULT NULL`) } catch {}
    try { this.db.exec(`ALTER TABLE models ADD COLUMN deleted_at TEXT DEFAULT NULL`) } catch {}
    // FK 字段 (先加字段 + 回填, 再考虑删老字段)
    try { this.db.exec(`ALTER TABLE api_keys ADD COLUMN assigned_model_id INTEGER DEFAULT NULL REFERENCES models(id) ON DELETE SET NULL`) } catch {}
    try { this.db.exec(`ALTER TABLE usage_stats ADD COLUMN model_id INTEGER DEFAULT NULL REFERENCES models(id) ON DELETE SET NULL`) } catch {}
    try { this.db.exec(`ALTER TABLE communication_log ADD COLUMN model_id INTEGER DEFAULT NULL REFERENCES models(id) ON DELETE SET NULL`) } catch {}
    // 授权表 (新表, IF NOT EXISTS 已保证幂等)
    try { this.db.exec(`CREATE TABLE IF NOT EXISTS api_key_models (api_key_id INTEGER NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE, model_id INTEGER NOT NULL REFERENCES models(id) ON DELETE CASCADE, PRIMARY KEY (api_key_id, model_id))`) } catch {}
    try { this.db.exec(`CREATE INDEX IF NOT EXISTS idx_api_key_models_key ON api_key_models(api_key_id)`) } catch {}
    try { this.db.exec(`CREATE INDEX IF NOT EXISTS idx_usage_stats_model_id ON usage_stats(model_id)`) } catch {}
    try { this.db.exec(`CREATE INDEX IF NOT EXISTS idx_commlog_model_id ON communication_log(model_id)`) } catch {}
    // 回填: 按裸名查 models.id, 找不到 (老 provider 被删前) 置 NULL
    try { this.db.exec(`UPDATE api_keys SET assigned_model_id = (SELECT id FROM models WHERE model_name = api_keys.assigned_model LIMIT 1) WHERE assigned_model IS NOT NULL AND assigned_model_id IS NULL`) } catch {}
    try { this.db.exec(`UPDATE usage_stats SET model_id = (SELECT id FROM models WHERE model_name = usage_stats.model_name LIMIT 1) WHERE model_id IS NULL AND model_name != ''`) } catch {}
    try { this.db.exec(`UPDATE communication_log SET model_id = (SELECT id FROM models WHERE model_name = communication_log.model_name LIMIT 1) WHERE model_id IS NULL AND model_name != ''`) } catch {}
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
