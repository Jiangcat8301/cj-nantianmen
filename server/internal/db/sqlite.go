package db

import (
	"database/sql"
	"fmt"
	"sync"

	_ "modernc.org/sqlite"
)

const Schema = `
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
  capability TEXT NOT NULL DEFAULT 'chat',
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

type Row = map[string]interface{}

type Result struct {
	Changes        int64
	LastInsertRowID int64
}

type DB struct {
	mu   sync.Mutex
	conn *sql.DB
	path string
}

var instance *DB

func Init(path string) error {
	conn, err := sql.Open("sqlite", path+"?_journal_mode=WAL&_foreign_keys=on")
	if err != nil {
		return fmt.Errorf("open sqlite: %w", err)
	}
	conn.SetMaxOpenConns(1)
	if _, err := conn.Exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON"); err != nil {
		return err
	}
	if _, err := conn.Exec(Schema); err != nil {
		return err
	}
	instance = &DB{conn: conn, path: path}
	// Run migrations (same as Node version)
	runMigrations()
	return nil
}

func runMigrations() {
	cols := []struct{ table, col, typ string }{
		{"models", "is_disabled", "INTEGER NOT NULL DEFAULT 0"},
		{"models", "input_price", "REAL NOT NULL DEFAULT 0"},
		{"models", "output_price", "REAL NOT NULL DEFAULT 0"},
		{"models", "cache_hit_price", "REAL NOT NULL DEFAULT 0"},
		{"communication_log", "duration_ms", "INTEGER DEFAULT NULL"},
		{"models", "capability", "TEXT NOT NULL DEFAULT 'chat'"},
		{"providers", "deleted_at", "TEXT DEFAULT NULL"},
		{"models", "deleted_at", "TEXT DEFAULT NULL"},
		{"api_keys", "assigned_model_id", "INTEGER DEFAULT NULL"},
		{"usage_stats", "model_id", "INTEGER DEFAULT NULL"},
		{"communication_log", "model_id", "INTEGER DEFAULT NULL"},
	}
	for _, c := range cols {
		instance.conn.Exec(fmt.Sprintf("ALTER TABLE %s ADD COLUMN %s %s", c.table, c.col, c.typ))
	}
	// Run legacy backfills (idempotent)
	instance.conn.Exec("UPDATE models SET deleted_at = datetime('now') WHERE deleted=1 AND deleted_at IS NULL")
	instance.conn.Exec("UPDATE api_keys SET assigned_model_id = (SELECT id FROM models WHERE model_name = api_keys.assigned_model LIMIT 1) WHERE assigned_model IS NOT NULL AND assigned_model_id IS NULL")
	instance.conn.Exec("UPDATE usage_stats SET model_id = (SELECT id FROM models WHERE model_name = usage_stats.model_name LIMIT 1) WHERE model_id IS NULL AND model_name != ''")
	instance.conn.Exec("UPDATE communication_log SET model_id = (SELECT id FROM models WHERE model_name = communication_log.model_name LIMIT 1) WHERE model_id IS NULL AND model_name != ''")
}

func Get() *DB {
	if instance == nil {
		panic("DB not initialized; call db.Init() first")
	}
	return instance
}

func Close() {
	if instance != nil {
		instance.conn.Close()
		instance = nil
	}
}

func (d *DB) Query(sql string, args ...interface{}) ([]Row, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	rows, err := d.conn.Query(sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	cols, _ := rows.Columns()
	var out []Row
	for rows.Next() {
		vals := make([]interface{}, len(cols))
		ptrs := make([]interface{}, len(cols))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return nil, err
		}
		m := make(Row)
		for i, c := range cols {
			v := vals[i]
			if b, ok := v.([]byte); ok {
				m[c] = string(b)
			} else {
				m[c] = v
			}
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func (d *DB) Run(sql string, args ...interface{}) (Result, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	res, err := d.conn.Exec(sql, args...)
	if err != nil {
		return Result{}, err
	}
	changes, _ := res.RowsAffected()
	id, _ := res.LastInsertId()
	return Result{Changes: changes, LastInsertRowID: id}, nil
}

func (d *DB) Exec(sql string) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	_, err := d.conn.Exec(sql)
	return err
}

func Int64(v interface{}) int64 {
	switch n := v.(type) {
	case int64:
		return n
	case float64:
		return int64(n)
	}
	return 0
}
func Str(v interface{}) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}
