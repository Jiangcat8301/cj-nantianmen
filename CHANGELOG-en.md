# Changelog (English)

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [v0.2.8] — 2026-07-16

### Added

- **Minimax `<function_calls>` XML v3 tool_call parser** (commit `b6e4ba5`): Detect the `<function_calls>` XML tool_call format under the Minimax protocol and convert it to the OpenAI standard. One of Minimax's 5 tool_call formats.

### Fixed

- **`openaiReqToAnthropic` non-string content** (commit `7dd6c22`): When an Anthropic-protocol downstream receives a message whose `content` is not a string (e.g. array of content blocks), stringify it during the OpenAI→Anthropic conversion to avoid downstream API errors.

## [v0.2.7] — 2026-07-15

### Added

- **commlog persistence migration**: The previous JSON `communication.log` file is replaced by a SQLite `communication_log` table with indexing, querying, and pagination (`?lines=`).
- **tool_use conversion**: Bidirectional bridge between OpenAI `tool_calls` and Anthropic `tool_use`.
- **SSE protocol conversion**: Streaming protocol bridge — OpenAI `data: {...}` ↔ Anthropic `event: ...`.
- **Graceful shutdown flush**: Server flushes in-memory usage / commlog batches to SQLite before exit.

### Fixed

- **Cached tokens double-billed**: The old cost formula `input × input_price + cached × cache` counted cached tokens twice. Now `(input - cached) × input_price + cached × cache`.

## [v0.2.10] — 2026-07-17

### Added

- **Models page "Enable All / Disable All" toggle**: When expanding a provider's model list, an aggregate toggle reflects the enable state of all its models. When all enabled, shows "Disable All" (bulk disable on click); when any disabled, shows "Enable All" (bulk enable on click). No new server endpoint — uses `Promise.all` over existing `PUT .../toggle`.
- **Default-model info card**: The free-form prose ("All provider 中首个设为 ★ 默认的模型...") at the top of the Models page is replaced by a rounded card containing "默认模型：Nantianmen-default" + a heroicons clipboard copy icon (clicking copies the model name) + a one-line explanation.
- **CLI `provider model-toggle <pid> <mid>`**: CLI entry point for the v0.2.9 model-disable feature (previously only available in desktop).
- **CLI `default-model` / `default_model`**: Query the current default model.
- **CLI `database info` / `database move`**: Show DB type/path/size/log_count; relocate the DB file (server-side operation).
- **CLI `stats` now prints `topModels` / `topProviders`**: Shares the same server-side aggregation as desktop.
- **macOS desktop CI** (`.github/workflows/build-mac.yml`): `macos-latest` runner builds `.dmg` + `.zip` × `x64` + `arm64`. Push of a `vX.Y.Z` tag auto-triggers; artifacts uploaded with 14-day retention. Avoids the platform limitation that Windows cannot cross-compile macOS via electron-builder. **Ad-hoc signed (no Apple Developer certificate); users must right-click → Open on first launch.**

### Changed

- **Left-nav order**: API Docs moved below Comm Log (sequence: Dashboard → Models → API Keys → Statistics → Comm Log → **API Docs** → Settings).
- **Stats breakdown now aggregated by provider**: Previously rendered one row per `(provider, model, api_key)` triple; now renders one row per provider with click-to-expand per-model details. Per-API-key detail moved to `nantianmen apikey ls` and the Users management UI. Mirrors `Stats.vue`'s `providerGroups`. CLI `stats` mirrors the same structure (provider → model).
- **CLI `cmdStats` cost formula unified**: Replaced the inline legacy formula (`input × input_price + cached × cache`, double-counting cached tokens) with the shared `calcCost` (`(input - cached) × input_price + output × output_price + cached × cache`). Four views (total-cost card, Top 3 model bar, Top 3 user bar, breakdown table) now produce identical totals.
- **`server topProviders` cost fix**: The old `byProvider` Map locked the price from the first row, so every model under that provider (e.g. Deepseek v4-pro vs v4-flash) was billed at v4-pro's price (3 / 6 / 0.025), inflating Deepseek total to ¥10.5509 vs the real ¥6.7949 = v4-pro ¥4.5381 + v4-flash ¥2.2568. Now sums cost per row using each row's own price; provider aggregate no longer carries a single price. `topModels` also gets a `cost` field as the single source of truth.
- **README author preface**: A short author preface added at the top (Chinese + English) explaining the motivation — "switching models by hand-editing every agent's config file is a profoundly *inelegant* affair".

### Fixed

- **CLI hard bugs** (left over from a v0.2.7 commit, only tolerated by bun-compiled exe):
  - `cli/index.js` L56 regex with 4 backslashes (should be 2) — `node 24` syntax error.
  - L476 `apikey: *** apikeys` — literal `***` makes the `CMDS` object syntactically invalid.
  - `call()` sets `Content-Type: application/json` even for empty-body PUT/POST, so Fastify rejects with `Body cannot be empty when content-type is set to 'application/json'`. Affects every body-less command.
  - `fn().catch()` crashes on `help` / `quit` (handlers return `undefined`, no `.catch`).

## [v0.2.9] — 2026-07-17

### Added

- **Model disable toggle**: each model row now has an enable/disable switch (green/red toggle). Disabled models are excluded from `/v1/models` and cannot be used through the gateway. Re-enabling manually is required to restore.
- **Stats Top 3 side-by-side**: Top 5→3 models/users displayed left-right on a single row at 50% width each, equal-height cards, no scrolling, fixed 400px height fits exactly 3 rows.

### Changed

- **Log management** ([#6](https://github.com/Jiangcat8301/cj-nantianmen/issues/6)): default retention 1000→500; second button shows "现有日志 n/max" (active count/max); lowering the limit immediately trims old records; list sorted by ID descending.
- **Dashboard stat cards** ([#2](https://github.com/Jiangcat8301/cj-nantianmen/issues/2)): replaced `grid-cols-5` with `flex + flex-1` equal-width layout — 6 cards (including DB volume) share one row, no wrapping; <1000px falls back to 4-per-row.
- **Stats page layout** ([#5](https://github.com/Jiangcat8301/cj-nantianmen/issues/5)): Top 5→3; model/user names moved above bars; value labels moved from inside bars to right side of bars; row gap `space-y-3→5`.
- **i18n fix**: Chinese locale "全部 Provider" → "全部供应商".
- **Unified token formatting**: `formatToken(n)` extracted to `desktop/src/lib/format.js`, shared by Stats/ApiKeys/Dashboard views. Supports K→M carry (>1024k shows M, 1-2 decimal digits).

### Fixed

- **Stats Top 5 duplicates** ([#4](https://github.com/Jiangcat8301/cj-nantianmen/issues/4)): same provider+model across multiple API keys was showing as multiple rows → server-side aggregation in `stats.query()` returns `topModels`/`topProviders` arrays.
- **User page token carry missing** ([#3](https://github.com/Jiangcat8301/cj-nantianmen/issues/3)): `ApiKeys.vue` local `fmt()` only handled K (no M), 1,500,000→"1500.0K" → now uses shared `formatToken` showing "1.50M".

## [v0.2.6] — 2026-07-16

### Fixed

- **Non-streaming response protocol conversion missing**: streaming path had `anthropicSSEToOpenAI()` for response conversion, non-streaming path returned raw upstream `data` as-is. MiniMax-CodingPlan returns Anthropic format (`content: [{text,...}]`) not OpenAI (`choices: [...]`) → Hindsight client received no `choices`. Added `anthropicRespToOpenAI()` / `openaiRespToAnthropic()` bidirectional non-streaming response converters.
- **Comm log token stats always zero**: `extractTokensOpenai`/`extractTokensAnthropic` return `{input_tokens, ...}` (snake_case), but `logEntry` destructures `{inputTokens, ...}` (camelCase) → `...captured` spread key mismatch → all `undefined` → all zero. `logEntry` now accepts both conventions: `inputTokens = inputTokens ?? input_tokens ?? 0`. Stats DB unaffected (`stats.record` uses `r.input_tokens`, matching extract return keys).

## [v0.2.5] — 2026-07-16

### Fixed

- **Stats timezone (deep fix)**: `u.created_at >= date('now','localtime')` → `datetime(u.created_at,'localtime') >= date('now','localtime')`. Previous fix only adjusted the reference side; UTC timestamps in DB were never converted to local → records from Beijing 00:00-08:00 slipped through because their UTC date was still the previous day. Applies to today/7d/30d.
- **API Key datetime display**: `created_at` and `last_used_at` now use `datetime(col,'localtime')` on read, displayed directly in local time.
- **Tray icon missing**: `main.cjs` referenced three non-existent `tray-online/offline/active.png` files → switched to existing `nantianmen.ico`.

### Added

- **UI filter persistence**: Stats and Logs page filters (provider/model/range) now saved to `ui_filters` in `nantianmen-conf.json`, surviving page navigation.

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
