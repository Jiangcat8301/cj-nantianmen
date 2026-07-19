import Database from 'better-sqlite3'
import { Database as IDatabase } from './interface.js'

// ponytail: legacy columns from pre-v0.2.14 schema. When detected at startup,
// we drop them after SCHEMA + ALTER + backfill. SQLite ≥ 3.35 supports DROP COLUMN;
// older builds keep the columns (harmless dead weight) and skip the cleanup.
// Launchers (desktop/CLI) read stdout lines '[ntm-cleanup] start/done' to show a loading hint.
const LEGACY_COLUMNS = [
  { table: 'api_keys', col: 'assigned_model', reason: 'replaced by assigned_model_id FK in v0.2.14' },
  { table: 'models',   col: 'deleted',        reason: 'replaced by deleted_at soft-delete in v0.2.14' },
]

function emit(msg) { try { process.stdout.write(`[ntm-cleanup] ${msg}\n`) } catch {} }

function listColumns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map(r => r.name)
}

// ponytail: find legacy columns still present in the DB. Empty array = nothing to do.
export function findLegacyColumns(db) {
  const present = []
  for (const { table, col } of LEGACY_COLUMNS) {
    if (listColumns(db, table).includes(col)) present.push({ table, col })
  }
  return present
}

// ponytail: SQLite ≥ 3.35 supports ALTER TABLE DROP COLUMN. Probe by issuing the actual SQL;
// erroring on "no other columns exist" still means the syntax works.
export function supportsDropColumn(db) {
  try {
    const v = db.prepare('SELECT sqlite_version() AS v').get()?.v
    if (v && parseFloat(v) >= 3.35) return true
  } catch {}
  return false
}

// ponytail: drop legacy columns when SQLite supports it. Idempotent; safe to call on every boot.
// Returns { dropped: [...], skipped: [...] } so the launcher can show what happened.
export function runLegacyCleanup(db) {
  const legacy = findLegacyColumns(db)
  if (legacy.length === 0) return { dropped: [], skipped: [] }
  if (!supportsDropColumn(db)) {
    emit(`skipped ${legacy.length} legacy column(s) (SQLite < 3.35)`)
    return { dropped: [], skipped: legacy.map(l => `${l.table}.${l.col}`) }
  }
  emit(`start (${legacy.length} column(s))`)
  const dropped = []
  for (const { table, col } of legacy) {
    try {
      db.exec(`ALTER TABLE ${table} DROP COLUMN ${col}`)
      dropped.push(`${table}.${col}`)
    } catch (e) { emit(`drop ${table}.${col} failed: ${e.message}`) }
  }
  emit(`done (${dropped.length}/${legacy.length} dropped)`)
  return { dropped, skipped: [] }
}

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
    // schema evolves: when a column's been DROP'd from SCHEMA, legacy dbs still have it
    // (runLegacyCleanup drops them after backfill); never re-add to keep idempotent.
    for (const col of ['is_disabled','input_price','output_price','cache_hit_price']) {
      try { this.db.exec(`ALTER TABLE models ADD COLUMN ${col} INTEGER NOT NULL DEFAULT 0`) } catch {}
    }
    // ponytail: communication_log.duration_ms — total wall time from request arrival to response
    try { this.db.exec(`ALTER TABLE communication_log ADD COLUMN duration_ms INTEGER DEFAULT NULL`) } catch {}
    // ponytail: v0.2.14 — model_id 化 + 软删除 + api_key 授权表
    // 软删除字段: 软删后 is_default/deleted_at 仍生效, JOIN 拿历史名
    try { this.db.exec(`ALTER TABLE providers ADD COLUMN deleted_at TEXT DEFAULT NULL`) } catch {}
    try { this.db.exec(`ALTER TABLE models ADD COLUMN deleted_at TEXT DEFAULT NULL`) } catch {}
    // ponytail: 回填 deleted_at from 老 deleted 列, 然后 legacy cleanup 会把 deleted 列 drop。
    // 只有 deleted 列存在时才跑 (老 schema); 已迁移的库 deleted 列已不存在。
    try {
      const cols = listColumns(this.db, 'models')
      if (cols.includes('deleted')) this.db.exec(`UPDATE models SET deleted_at = datetime('now') WHERE deleted = 1 AND deleted_at IS NULL`)
    } catch {}
    // FK 字段: ALTER TABLE ADD COLUMN 不支持 REFERENCES, 去掉约束只加列 (SCHEMA 重建时会有 FK)
    try { this.db.exec(`ALTER TABLE api_keys ADD COLUMN assigned_model_id INTEGER DEFAULT NULL`) } catch {}
    try { this.db.exec(`ALTER TABLE usage_stats ADD COLUMN model_id INTEGER DEFAULT NULL`) } catch {}
    try { this.db.exec(`ALTER TABLE communication_log ADD COLUMN model_id INTEGER DEFAULT NULL`) } catch {}
    // 授权表 (新表, IF NOT EXISTS 已保证幂等)
    try { this.db.exec(`CREATE TABLE IF NOT EXISTS api_key_models (api_key_id INTEGER NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE, model_id INTEGER NOT NULL REFERENCES models(id) ON DELETE CASCADE, PRIMARY KEY (api_key_id, model_id))`) } catch {}
    try { this.db.exec(`CREATE INDEX IF NOT EXISTS idx_api_key_models_key ON api_key_models(api_key_id)`) } catch {}
    try { this.db.exec(`CREATE INDEX IF NOT EXISTS idx_usage_stats_model_id ON usage_stats(model_id)`) } catch {}
    try { this.db.exec(`CREATE INDEX IF NOT EXISTS idx_commlog_model_id ON communication_log(model_id)`) } catch {}
    // ponytail: 回填: 按裸名查 models.id, 找不到 (老 provider 被删前) 置 NULL.
    // 只有 assigned_model 列存在时才跑 (老 schema); 已迁移的库该列已 drop.
    try {
      const cols = listColumns(this.db, 'api_keys')
      if (cols.includes('assigned_model')) {
        this.db.exec(`UPDATE api_keys SET assigned_model_id = (SELECT id FROM models WHERE model_name = api_keys.assigned_model LIMIT 1) WHERE assigned_model IS NOT NULL AND assigned_model_id IS NULL`)
        this.db.exec(`UPDATE usage_stats SET model_id = (SELECT id FROM models WHERE model_name = usage_stats.model_name LIMIT 1) WHERE model_id IS NULL AND model_name != ''`)
        this.db.exec(`UPDATE communication_log SET model_id = (SELECT id FROM models WHERE model_name = communication_log.model_name LIMIT 1) WHERE model_id IS NULL AND model_name != ''`)
      }
    } catch {}
    // ponytail: drop legacy columns now that backfill is done. Idempotent — no-op when
    // columns already absent or SQLite < 3.35.
    try { runLegacyCleanup(this.db) } catch {}
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
