# Changelog (English)

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [v0.2.0] - 2026-07-15

### ⚠ Breaking

- **Architecture rewrite: Python → Node.js**. Server now uses Fastify + better-sqlite3; CLI is Node.js (Go removed); Desktop forks Node.js server (no longer spawns Python uvicorn).
- **Default port 7300 → 38271**, listening on `0.0.0.0`.
- **Storage format change**: removed `server/data/nantianmen.db` and `requirements.txt`. New `nantianmen-conf.json` lives next to the executable, holds `server_host`, `server_port`, `password`, `salt`, `database`.
- **First-time setup required**. Only a server that has gone through `POST /api/admin/setup` activates DB-backed routes.
- **Provider name must not contain spaces or underscores** (unchanged from v0.1).

### Added

- `nantianmen-conf.json`: single-file config + memory-resident; written by setup, not by CRUD. `process.stdin.unref()` shields server from Hermes/CI stdin-close.
- Admin auth: header `Authorization: Bearer M` (`M = md5(RAWPASSWORD)`); server validates `md5(M + conf.salt)`.
  - `POST /api/admin/setup` (only when uninitialized)
  - `POST /api/admin/login`
  - `POST /api/admin/password/change` (regenerates salt → old password immediately invalid)
  - `POST /api/admin/database/configure`
  - `GET/PUT /api/admin/settings`
  - `POST /api/admin/server/{shutdown,restart}`
- DB abstraction: `db/interface.js` + `db/sqlite.js` (better-sqlite3, WAL) + `db/mysql.js` (placeholder, throws).
- Database backend chosen at first-time setup; later switch via `database/configure`.
- In-memory model map (`services/modelMap.js`): O(1) resolve of `{name}_{protocol}_{model}`; entry holds endpoint + headers; zero DB reads on hot path.
- Streaming proxy: Node fetch + async iterator; SSE pass-through.
- Token stats: in-memory buffer + 10s batched INSERT; `/api/admin/stats` returns SUM aggregates.

### CLI

New `nantianmen` binary:

| Command | Purpose |
| --- | --- |
| `setup` | Interactive init (host/port/db/admin password ×2) |
| `login` | Save admin password to `~/.nantianmen/config.json` |
| `database` | Switch DB backend (SQLite3 / MySQL) |
| `settings` | Read live server config |
| `password` | Change admin password (old / new ×2) |
| `provider {ls\|add\|rm}` | Provider CRUD |
| `apikey {new\|ls\|rm}` | API key CRUD |
| `stats` | Aggregated usage query |
| `restart` / `shutdown` | Server process control |

Global flags: `-H/--host`, `--port`, `-P/--password` (RAW → internally md5'd). Resolution order: `--flag > $ENV > ~/.nantianmen/config.json > error`.

### Desktop

- `electron/main.js` switched to `fork('./server/index.js')`; removed `getPythonPath`.
- Port constant `SERVER_PORT = 38271`.
- Setup wizard / data-storage UI in Desktop deferred to a later release; v0.2 ships a working Server + CLI; Desktop requires running `nantianmen setup` once.

### Removed

- `server/app/`, `server/.venv/`, `server/requirements.txt`, `cli/nantianmen.exe` (Go).

### Tests

- `server/test_setup.js`: 20/20 PASS (setup, restart, login, password change, salt rotation).
- `tools/run-cli-e2e.js`: 10/10 PASS — password verified end-to-end:
  - Wrong password → server returns 401
  - After password change, old md5 + old salt fails
  - New password + new salt works

---

## [v0.1.0]

### Added

- Project init: three-directory layout (server / desktop / cli)
- Server: Python FastAPI skeleton
- Desktop: Electron + Vue3 + Vite + Tailwind CSS skeleton
- CLI: Go static binary skeleton
- SQLite schema (providers / api_keys / models / usage_stats / settings)
- Provider CRUD, user management, LLM proxy, protocol conversion, stats, PID lock
- Cross-platform: Windows / Linux / macOS
