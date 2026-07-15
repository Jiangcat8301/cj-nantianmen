# Changelog (English)

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [v0.2.4] — 2026-07-15

### Added

- **API Key editing**: Desktop user management now has edit button for name and note; comm log entries auto-rename on edit
- **CLI API Key editing**: `nantianmen apikey edit <id> <name> <note> [oldName]`

### Fixed

- **Stats timezone**: `date('now')` → `date('now','localtime')` — Dashboard/Stats/Tray "today" now starts at local 00:00
- **Stats empty dropdowns**: provider/model selects now populated from registered data

### Changed

- Nav label: "统计" → "数据统计"

## [v0.2.3] — 2026-07-15

### Added

- **Communication log**: `services/commlog.js` records raw input/output for every request (streaming responses end with `[stop]` marker), stored as JSON in `communication_log.json` (userData dir), capped at 1000 entries.
  - Log routes: `GET /api/admin/communication-log` (filters: `?provider_id=&model_name=&user_id=`), `DELETE` to clear, `GET/PUT .../config` toggle (`log_enabled` in conf)
  - Desktop: new "Comm Log" page (📝 in left nav), enable/clear/filter/inline detail expand
  - CLI: `nantianmen log [ls|clear|enable|disable|config] [--provider ID] [--model NAME] [--user ID]`
- **SSE protocol conversion**: `llmProxy.js` adds `anthropicSSEToOpenAI()` — when Agent uses OpenAI protocol but Provider is Anthropic, streaming responses are real-time converted from Anthropic SSE to OpenAI SSE format, fixing the `empty stream with no finish_reason` error.
- **Desktop titlebar version**: `v0.2.3` displayed next to server status
- **Tray daily stats**: tray context menu shows 📥📤💾💰 today's tokens + cost (15s polling)
- **Tray i18n**: tray menu supports zh/en/ja, synced with Desktop language setting
- **CLI feature parity**: `provider models/models-refresh/model-add/model-edit/default`, `stats --range=today|7d|30d`, `settings set --port=N`
- **API Docs**: added log endpoint documentation

### Changed

- **Model name format**: `{name}_{protocol}_{model}` → `{name}_{model}` (protocol segment removed). In-memory routing and `/v1/models` output are consistent.
- **Window state persistence**: migrated from standalone `window-state.json` to `nantianmen-conf.json` `window_state` field
- **Desktop scrollbar**: global custom dark thin scrollbar (WebKit + Firefox)
- **Desktop log list**: newest first, added "Cached" column, filter labels show "All Providers/All Users"
- **Desktop protocol tag colors**: Provider list and Dashboard protocol tags — OpenAI blue, Anthropic orange
- **Desktop model management**: price font size increased, default model description in Chinese, copy format updated
- **Tray menu**: removed start/stop server options

### Fixed

- **SSE empty stream** (root cause fix): previous `reply.raw.writeHead/end` solved Fastify serialization but Anthropic SSE format was unparseable by OpenAI clients. v0.2.3 fully resolves via real-time protocol conversion.
- **Tray start/stop state lag**: click handlers now call `buildTrayMenu()` immediately to refresh the menu

## [v0.2.0] - 2026-07-15

### ⚠ Breaking

- **Architecture rewrite: Python → Node.js**. Server now uses Fastify + better-sqlite3; CLI is Node.js (Go removed); Desktop forks Node.js server (no longer spawns Python uvicorn).
- **Default port 7300 → 38271**, listening on `0.0.0.0`.
- **Storage format change**: removed `server/data/nantianmen.db` and `requirements.txt`. New `nantianmen-conf.json` lives next to the executable.
- **First-time auto-init**: server auto-creates default conf if missing (`password = md5(md5('admin') + salt)`).
- **Provider name must not contain spaces or underscores** (unchanged from v0.1).

### Added

- `nantianmen-conf.json`: single-file config + memory-resident.
- Admin auth: `Bearer M = md5(RAWPASSWORD)`, server validates `md5(M + conf.salt)`.
- Password change: salt rotation, old password immediately invalid.
- DB abstraction: SQLite3 (better-sqlite3, WAL) + MySQL placeholder.
- In-memory model map: `{name}_{protocol}_{model}` O(1) resolve.
- Streaming proxy: Node fetch + SSE pass-through.
- Token stats: in-memory buffer + 10s batched INSERT.
- Desktop: Electron + Vue3 + Vite + Tailwind + frameless titlebar + tray + splash screen.
- CLI: subcommand system (setup/health/login/database/settings/password/provider/apikey/stats/restart/shutdown).
- Unified user-data dir `cj-nantianmen/` across all three launchers.
- `-c/-D` server CLI flags for custom paths.

### Fixed

- SSE streaming empty body: `reply.raw.writeHead/write/end` replaces Fastify JSON serialization.
- Default model routing: `resolveModel()` uses `getDefaultEntry()`.
- Streaming stats lost on `usage:null`.
- Model list disappearing after set-default: `load()`/`fetchModels()` order fixed.
- Provider edit API key overwrite: `??` → `||`.

---

## [v0.1.0]

### Added

- Project init: three-directory layout (server / desktop / cli)
- Server: Python FastAPI skeleton
- Desktop: Electron + Vue3 + Vite + Tailwind CSS skeleton
- CLI: Go static binary skeleton
- SQLite schema (providers / api_keys / models / usage_stats / settings)
- Provider CRUD, user management, LLM proxy, protocol conversion, stats
- Cross-platform: Windows / Linux / macOS
