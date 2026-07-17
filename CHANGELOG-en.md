1|# Changelog (English)
2|
3|All notable changes to this project will be documented in this file.
4|
5|The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
6|and this project adheres to [Semantic Versioning](https://semver.org/).
7|
8|## [v0.2.9] — 2026-07-17
9|
10|### Added
11|
12|- **Model disable toggle**: each model row now has an enable/disable switch (green/red toggle). Disabled models are excluded from `/v1/models` and cannot be used through the gateway. Re-enabling manually is required to restore.
13|- **Stats Top 3 side-by-side**: Top 5→3 models/users displayed left-right on a single row at 50% width each, equal-height cards, no scrolling, fixed 400px height fits exactly 3 rows.
14|
15|### Changed
16|
17|- **Log management** ([#6](https://github.com/Jiangcat8301/cj-nantianmen/issues/6)): default retention 1000→500; second button shows "现有日志 n/max" (active count/max); lowering the limit immediately trims old records; list sorted by ID descending.
18|- **Dashboard stat cards** ([#2](https://github.com/Jiangcat8301/cj-nantianmen/issues/2)): replaced `grid-cols-5` with `flex + flex-1` equal-width layout — 6 cards (including DB volume) share one row, no wrapping; <1000px falls back to 4-per-row.
19|- **Stats page layout** ([#5](https://github.com/Jiangcat8301/cj-nantianmen/issues/5)): Top 5→3; model/user names moved above bars; value labels moved from inside bars to right side of bars; row gap `space-y-3→5`.
20|- **i18n fix**: Chinese locale "全部 Provider" → "全部供应商".
21|- **Unified token formatting**: `formatToken(n)` extracted to `desktop/src/lib/format.js`, shared by Stats/ApiKeys/Dashboard views. Supports K→M carry (>1024k shows M, 1-2 decimal digits).
22|
23|### Fixed
24|
25|- **Stats Top 5 duplicates** ([#4](https://github.com/Jiangcat8301/cj-nantianmen/issues/4)): same provider+model across multiple API keys was showing as multiple rows → server-side aggregation in `stats.query()` returns `topModels`/`topProviders` arrays.
26|- **User page token carry missing** ([#3](https://github.com/Jiangcat8301/cj-nantianmen/issues/3)): `ApiKeys.vue` local `fmt()` only handled K (no M), 1,500,000→"1500.0K" → now uses shared `formatToken` showing "1.50M".
27|
28|## [v0.2.6] — 2026-07-16
29|
30|### Fixed
31|
32|- **Non-streaming response protocol conversion missing**: streaming path had `anthropicSSEToOpenAI()` for response conversion, non-streaming path returned raw upstream `data` as-is. MiniMax-CodingPlan returns Anthropic format (`content: [{text,...}]`) not OpenAI (`choices: [...]`) → Hindsight client received no `choices`. Added `anthropicRespToOpenAI()` / `openaiRespToAnthropic()` bidirectional non-streaming response converters.
33|- **Comm log token stats always zero**: `extractTokensOpenai`/`extractTokensAnthropic` return `{input_tokens, ...}` (snake_case), but `logEntry` destructures `{inputTokens, ...}` (camelCase) → `...captured` spread key mismatch → all `undefined` → all zero. `logEntry` now accepts both conventions: `inputTokens = inputTokens ?? input_tokens ?? 0`. Stats DB unaffected (`stats.record` uses `r.input_tokens`, matching extract return keys).
34|
35|## [v0.2.5] — 2026-07-16
36|
37|### Fixed
38|
39|- **Stats timezone (deep fix)**: `u.created_at >= date('now','localtime')` → `datetime(u.created_at,'localtime') >= date('now','localtime')`. Previous fix only adjusted the reference side; UTC timestamps in DB were never converted to local → records from Beijing 00:00-08:00 slipped through because their UTC date was still the previous day. Applies to today/7d/30d.
40|- **API Key datetime display**: `created_at` and `last_used_at` now use `datetime(col,'localtime')` on read, displayed directly in local time.
41|- **Tray icon missing**: `main.cjs` referenced three non-existent `tray-online/offline/active.png` files → switched to existing `nantianmen.ico`.
42|
43|### Added
44|
45|- **UI filter persistence**: Stats and Logs page filters (provider/model/range) now saved to `ui_filters` in `nantianmen-conf.json`, surviving page navigation.
46|
47|## [v0.2.4] — 2026-07-15
48|
49|### Added
50|
51|- **API Key editing**: Desktop user management now has edit button for name and note; comm log entries auto-rename on edit
52|- **CLI API Key editing**: `nantianmen apikey edit <id> <name> <note> [oldName]`
53|
54|### Fixed
55|
56|- **Stats timezone**: `date('now')` → `date('now','localtime')` — Dashboard/Stats/Tray "today" now starts at local 00:00
57|- **Stats empty dropdowns**: provider/model selects now populated from registered data
58|
59|### Changed
60|
61|- Nav label: "统计" → "数据统计"
62|
63|## [v0.2.3] — 2026-07-15
64|
65|### Added
66|
67|- **Communication log**: `services/commlog.js` records raw input/output for every request (streaming responses end with `[stop]` marker), stored as JSON in `communication_log.json` (userData dir), capped at 1000 entries.
68|  - Log routes: `GET /api/admin/communication-log` (filters: `?provider_id=&model_name=&user_id=`), `DELETE` to clear, `GET/PUT .../config` toggle (`log_enabled` in conf)
69|  - Desktop: new "Comm Log" page (📝 in left nav), enable/clear/filter/inline detail expand
70|  - CLI: `nantianmen log [ls|clear|enable|disable|config] [--provider ID] [--model NAME] [--user ID]`
71|- **SSE protocol conversion**: `llmProxy.js` adds `anthropicSSEToOpenAI()` — when Agent uses OpenAI protocol but Provider is Anthropic, streaming responses are real-time converted from Anthropic SSE to OpenAI SSE format, fixing the `empty stream with no finish_reason` error.
72|- **Desktop titlebar version**: `v0.2.3` displayed next to server status
73|- **Tray daily stats**: tray context menu shows 📥📤💾💰 today's tokens + cost (15s polling)
74|- **Tray i18n**: tray menu supports zh/en/ja, synced with Desktop language setting
75|- **CLI feature parity**: `provider models/models-refresh/model-add/model-edit/default`, `stats --range=today|7d|30d`, `settings set --port=N`
76|- **API Docs**: added log endpoint documentation
77|
78|### Changed
79|
80|- **Model name format**: `{name}_{protocol}_{model}` → `{name}_{model}` (protocol segment removed). In-memory routing and `/v1/models` output are consistent.
81|- **Window state persistence**: migrated from standalone `window-state.json` to `nantianmen-conf.json` `window_state` field
82|- **Desktop scrollbar**: global custom dark thin scrollbar (WebKit + Firefox)
83|- **Desktop log list**: newest first, added "Cached" column, filter labels show "All Providers/All Users"
84|- **Desktop protocol tag colors**: Provider list and Dashboard protocol tags — OpenAI blue, Anthropic orange
85|- **Desktop model management**: price font size increased, default model description in Chinese, copy format updated
86|- **Tray menu**: removed start/stop server options
87|
88|### Fixed
89|
90|- **SSE empty stream** (root cause fix): previous `reply.raw.writeHead/end` solved Fastify serialization but Anthropic SSE format was unparseable by OpenAI clients. v0.2.3 fully resolves via real-time protocol conversion.
91|- **Tray start/stop state lag**: click handlers now call `buildTrayMenu()` immediately to refresh the menu
92|
93|## [v0.2.0] - 2026-07-15
94|
95|### ⚠ Breaking
96|
97|- **Architecture rewrite: Python → Node.js**. Server now uses Fastify + better-sqlite3; CLI is Node.js (Go removed); Desktop forks Node.js server (no longer spawns Python uvicorn).
98|- **Default port 7300 → 38271**, listening on `0.0.0.0`.
99|- **Storage format change**: removed `server/data/nantianmen.db` and `requirements.txt`. New `nantianmen-conf.json` lives next to the executable.
100|- **First-time auto-init**: server auto-creates default conf if missing (`password = md5(md5('admin') + salt)`).
101|- **Provider name must not contain spaces or underscores** (unchanged from v0.1).
102|
103|### Added
104|
105|- `nantianmen-conf.json`: single-file config + memory-resident.
106|- Admin auth: `Bearer M = md5(RAWPASSWORD)`, server validates `md5(M + conf.salt)`.
107|- Password change: salt rotation, old password immediately invalid.
108|- DB abstraction: SQLite3 (better-sqlite3, WAL) + MySQL placeholder.
109|- In-memory model map: `{name}_{protocol}_{model}` O(1) resolve.
110|- Streaming proxy: Node fetch + SSE pass-through.
111|- Token stats: in-memory buffer + 10s batched INSERT.
112|- Desktop: Electron + Vue3 + Vite + Tailwind + frameless titlebar + tray + splash screen.
113|- CLI: subcommand system (setup/health/login/database/settings/password/provider/apikey/stats/restart/shutdown).
114|- Unified user-data dir `cj-nantianmen/` across all three launchers.
115|- `-c/-D` server CLI flags for custom paths.
116|
117|### Fixed
118|
119|- SSE streaming empty body: `reply.raw.writeHead/write/end` replaces Fastify JSON serialization.
120|- Default model routing: `resolveModel()` uses `getDefaultEntry()`.
121|- Streaming stats lost on `usage:null`.
122|- Model list disappearing after set-default: `load()`/`fetchModels()` order fixed.
123|- Provider edit API key overwrite: `??` → `||`.
124|
125|---
126|
127|## [v0.1.0]
128|
129|### Added
130|
131|- Project init: three-directory layout (server / desktop / cli)
132|- Server: Python FastAPI skeleton
133|- Desktop: Electron + Vue3 + Vite + Tailwind CSS skeleton
134|- CLI: Go static binary skeleton
135|- SQLite schema (providers / api_keys / models / usage_stats / settings)
136|- Provider CRUD, user management, LLM proxy, protocol conversion, stats
137|- Cross-platform: Windows / Linux / macOS
138|