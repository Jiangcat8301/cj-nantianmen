# Changelog (English)

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

### Fixed — FRPC custom domain verbatim + log pane

- **Domain written verbatim to `customDomains`**: the old renderToml appended the frps serverAddr host as a root domain (`subdomain + "." + serverAddr-host`), forcing every user under the frps hostname and double-suffixing full-domain inputs like `nantianmen.ylpb360.com`. Fixed: `customDomains = [<user input verbatim>]`, nothing derived. frp's `customDomains` is a full-domain list with no relationship to serverAddr — frps host a.com + user vhost b.net is fully legal. `startFrpc()` now requires server_addr + server_port + a custom domain (HTTP mode can't route without customDomains). i18n `frpc_field_subdomain` → "Custom domain (full, e.g. b.net)" ×3 languages.
- **FRPC log pane**: ReverseProxy page now shows a scrollable log panel at the bottom — frpc stdout/stderr, capped at 100 lines (main-process in-memory ring buffer, auto-scrolls to bottom). Main now pipes frpc stdio into both the log file and an in-memory buffer (`feedLogChunk` line-splits); new IPC `frpc:log:get`. Frontend polls via `refreshLog()` every 2s and colors lines by `[E]/[W]/[I]`. When frpc isn't running it falls back to tailing the last 100 lines of `frpc.log`. Trilingual i18n adds `frpc_log_title` / `frpc_log_empty`.

### Fixed — FRPC HTTP routing by subdomain (was `remotePort`)

- frps HTTP mode shares one port (typically 20080) across all proxies and routes by `Host` header — `remotePort` is dead weight in HTTP mode. The previous `remote_port` form field + toml `remotePort = ...` were inert.
- Switched to a `subdomain` field: the user enters a unique string (e.g. `jiangcat`) and the toml becomes `subdomainHost = "jiangcat.<serverAddr-base>"` + `customDomains = [...]`. Other Nantianmen users pick a different subdomain and coexist on the same frps.
- frpc 0.71.0 supports `subdomainHost` / `customDomains` natively.
- UI: `remote_port` form field replaced with a text `subdomain` field (placeholder `jiangcat`); the old `remote_port` key is preserved in the conf object for back-compat but ignored by the toml writer. `startFrpc()` now only requires `server_addr + server_port` (subdomain is optional).
- i18n: three languages add `frpc_field_subdomain` (`子域名（必须唯一）` / `Subdomain (must be unique)` / `サブドメイン（必須ユニーク）`); `frpc_field_remote_port` copy updated to flag it as unused in HTTP mode.

### Fixed — FRPC proxy type: `tcp` → `http`

- `renderToml()` previously wrote `type = "tcp"` (a raw TCP tunnel). With TCP the frps only sees a client + a raw TCP channel — there's no way to route an HTTP request to it (no vhost / subdomain / path matching). The use case is public-internet access to Nantianmen's OpenAI-compatible `/v1/chat/completions`, which needs HTTP.
- Switched to `type = "http"` with `customDomains = ["nantianmen.local"]` and `locations = ["/"]`. frps now exposes a real HTTP endpoint on `remotePort` and reverse-proxies it to `127.0.0.1:localPort` over the tunnel.
- frpc 0.71.0 supports `type = "http"` natively (no plugin).
- Access pattern: public `http://frps-ip:remotePort/` (or `http://domain:remotePort/` once a domain is bound) → frps → frpc tunnel → local Nantianmen server.

## [v0.5.0] — 2026-08-20

### Fixed — Tray FRPC enable/disable UI + better error handling

- **Tray FRPC enable/disable is now a checkbox switch**: the previous tray menu exposed both "启用 FRPC" and "停用 FRPC" as independent menu items when `enabled=true`, which is two items where users expect a single toggle. Fix: replaced with Electron's native `type: 'checkbox'` menu item (label = "FRPC 公网穿透" / "FRP tunnel" / "FRP トンネル"). The check state mirrors `frpc.enabled`; clicking flips between `frpc.enable()` and `frpc.disable()` (disable also kills the running process). The `enabled=true` branch still shows the separate "Start/Stop FRPC" row whose label flips by `frpc.isRunning()`. Trilingual trayLabels gains `frpcEnableToggle`.
- **"FRPC config incomplete" had a hostile error message**: a fresh install with no FRPS fields would surface `Error invoking remote method 'frpc:start': Error: FRPC config incomplete (server_addr / server_port / remote_port required)` and leave the user stuck. Fix: `frpc.start()` now returns typed `{ ok:false, reason:'config-incomplete', message: ... }` instead of throwing, AND fires `frpc:open-settings` IPC. App.vue's `onOpenSettings` listener sets `window.location.hash='#/reverse-proxy'` to route the user to the settings page. Vue's `start()` translates `reason` to the new i18n key `frpc_err_config_incomplete`. Trilingual trayLabels / i18n add one key each. `no-binary` follows the same typed pattern (also no longer throws).

### Fixed — Reverse-proxy download UX bugs (3 fixes)

- **No cancel button during download**: the original "downloading" state only disabled the start button, leaving users stuck watching a 13.9 MB download finish even when they realized they hit the wrong button. Fix: while `downloading` is true the button now renders as a red **「取消下载」** that triggers `AbortController.abort()` — main immediately destroys the HTTPS request, deletes the partial tmp file, and broadcasts `frpc:download:state { cancelled:true }`. The UI snaps back to the green download button. Trilingual i18n adds `frpc_btn_cancel`.
- **Proxy not honoured**: `https.get(url)` was bypassing the OS proxy entirely, so users with a 1099-port proxy got `ETIMEDOUT 20.205.243.166`. Fix:
  1. Electron main reads `HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings` (ProxyEnable / ProxyServer) at startup to discover `127.0.0.1:1099`.
  2. Uses the already-installed `https-proxy-agent` package (Electron transitive dep — **no new npm dep added**) to construct an `HttpsProxyAgent`. Node <22's native `https.get` does NOT honour `HTTPS_PROXY` env vars — that's why just setting the env var didn't help.
  3. Precedence chain: nantianmen-conf.json `proxy=custom` → `proxy=direct` → IE-registry system proxy → direct.
  4. Error surface tightened: `<code> <message>` (was `socket hang up` for everything).
- **Route switch hides download progress**: navigating away from the Reverse Proxy page and back lost the "downloading" UI even though main was still streaming bytes. Fix: Electron main now keeps `downloadState` in module scope and broadcasts `frpc:download:state` to every window on every transition. `ReverseProxy.vue` subscribes via `onDownloadState` and additionally calls `downloadState()` on remount to rehydrate after a route round-trip — and shows a small "切到其他页面不影响下载" hint so the user knows it's intentional. Trilingual i18n adds `frpc_keep_alive_hint`.
- New IPC channels: `frpc:cancelDownload` (cancel) + `frpc:downloadState` (query); preload bridge updated.

### Changed — Copy fix

- "FRPC project page" → "FRP project page" (zh/en/ja). frp's official project name is "frp"; `frpc`/`frps` are client/server binary names, not the project name — earlier copy used the executable name in places that should be the project name.
- "use FRPC to tunnel your local port through a public FRPS" → "use FRP Client to tunnel your local port through a public FRP Server" (zh/en/ja). Same reason.

### Added — Titlebar three-chip indicator (FRPC / Server / version)

- The desktop custom titlebar now shows three independent chips on the right, separated by `border-r border-gray-700/50` hairlines, left to right:
  - **`FRPC` status** — four states: not-downloaded / disabled (gray) / stopped (amber) / running (emerald).
  - **`Server` status** — unchanged colors: online (emerald) / offline (red) / version mismatch (amber).
  - **`Version vX.Y.Z`** — mono font gray, shows the desktop client version.
- New `frpcStatus` ref + three computed properties (`frpcDotClass` / `frpcTextClass` / `frpcLabel`) plus `refreshFrpcStatus()`. 3-second polling plus a live `frpc:status` IPC hook so the chip updates the instant the user changes state on the Reverse Proxy page.
- Trilingual i18n adds `frpc_titlebar_hint` (hover tooltip "Open the Reverse Proxy sidebar to manage FRPC") and `version_label` ("版本" / "Version" / "バージョン").
- **Desktop UI only**: server and CLI have no awareness of this; no cross-process ABI impact.

### Build — v0.5.0 Windows artifacts (SHA-256 anchors for future grep)
| Artifact | size | SHA-256 |
|---|---|---|
| `nantianmen-server-v0.5.0-win-x64.exe` | 11.66 MB | `299a8df633e7415cf5de6ee6c6670781e8684039268d7f4d491bb18090f3281b` |
| `nantianmen-0.5.0-win-x64.exe` (desktop portable, bundles v0.5.0 server alias) | 79.08 MB | `ae7d1abbba636d848e310d62...` |
- Server binary built with `go build -ldflags="-s -w"` (stripped symbols) — 5 MB leaner than v0.4.24 (16.92 MB).
- Desktop size down from v0.4.24 (83.56 MB) to **79.08 MB** (4.5 MB leaner — server dropped 16.93 MB → 11.66 MB). asar picks up the new `electron/frpc.cjs` + `src/views/ReverseProxy.vue`; vite tree-shake absorbs them, no new `node_modules` deps.
- asar verification passed: FRPC IPC handlers, `providersCache` 5 s TTL, trilingual tray labels, Vue i18n keys all confirmed inside the bundle.

### Added — Tray menu FRPC start/stop + one-click default-model picker

- **Tray menu FRPC enable/disable**: shown only when `~/.cj-nantianmen/frpc/frpc.exe` is detected. Two states: `enabled=true` shows "Start FRPC / Stop FRPC" plus "Disable FRPC" (Disable kills the process and persists `enabled=false`); `enabled=false` shows a single "Enable FRPC" entry (persists `enabled=true` only, doesn't auto-launch). Reuses the existing `frpc.cjs` module exports — no new IPC handler.
- **Tray "Set default model" submenu**: two-level. Level 1 = providers (alphabetical). Level 2 = every `is_disabled=0` model under that provider (disabled models are filtered out). The current default model gets a `✓ current default` suffix (zh / en / ja). When `input_price` / `output_price` are present, a price tag like `💰 in $X/M  out $Y/M` is appended; missing fields degrade gracefully (the `/providers` endpoint doesn't include pricing — switch to `GET /api/admin/models` if you need it).
- **Zero server changes**: purely client. Reuses existing `GET /api/admin/providers` (returns nested models with `is_default`/`is_disabled`) and `PUT /api/admin/providers/{id}/models/{modelId}/default` (the server already zeroes other `is_default` flags and there's no chi middleware on the route, so no auth header needed). 5 s TTL cache on providers list; invalidated immediately after a successful default switch.
- **trayLabels trilingual extension**: zh / en / ja gain 6 keys plus a `priceFmt` function (`frpcEnable / frpcDisable / frpcStart / frpcStop / setDefaultModel / defaultModelCurrent / defaultModelNone / defaultModelErr`). Inline-dict pattern preserved — no new dependencies.

### Added — FRPC enable / disable toggle (independent from "Start with Nantianmen")

- New **`frpc.enabled`** config field: the user's master "should FRPC run?" toggle. Disable = kill the process + persist `enabled=false`; enable = persist `enabled=true` (the process stays in whatever state it was — start it manually if you want it running). Every other field (server_addr / token / ports) is preserved verbatim.
- **`enabled` and `auto_start` are decoupled**: enable / disable only touches `enabled`, never `auto_start`. `auto_start=true + enabled=false` = configured but deliberately offline; `auto_start=false + enabled=true` = won't auto-launch but can be started manually.
- **Desktop**: the Reverse Proxy page now has a primary "Enable / Disable" button (in the slot previously occupied by Start/Stop) plus a 3-state status indicator (Disabled grey / Stopped amber / Running green). Start / Stop buttons only appear while `enabled=true`. Clicking Disable calls `frpc.stop()` first, then persists. Trilingual i18n adds `frpc_btn_enable` / `frpc_btn_disable` / `frpc_status_disabled`.
- **CLI**: new `reverse-proxy enable` and `reverse-proxy disable` subcommands. `disable` stops the process then persists `enabled=false`; `enable` only persists `enabled=true`. `status` now prints `enabled`. `config` accepts `enabled=true|false`. The help line is updated.
- **Boot behaviour change**: `autoStartIfEnabled()` in the Electron main gains an `if (!c.enabled) return` early-return; legacy configs (without the `enabled` field) default to `enabled=true` for back-compat.

### Added — Public-internet tunneling / FRPC reverse proxy

- **New "Reverse Proxy" sidebar page** in the Desktop UI (path `/reverse-proxy`). The top of the page has an intro + a FRPC GitHub link + a prominent "Download latest FRPC" button + progress bar. After download completes, a 6-field config form appears (FRPS address / port / token, remote port, local port) + an "Start with Nantianmen" toggle + start/stop buttons + status indicator (running pid / stopped) + the binary path. Trilingual i18n (zh / en / ja) gains 17 new keys.
- **FRPC binary manager**: the "Download" button pulls the platform-appropriate zip / tar.gz from GitHub releases `v0.71.0` (macOS arm64 / x64, Windows amd64 / arm64, Linux amd64 / arm64), then uses the system `tar` (Windows 10 1803+ ships `tar.exe`) to extract `frpc[.exe]` straight into `userData/frpc/`. Download progress is throttled to 200 ms intervals and pushed to the renderer via the IPC channel `frpc:download:progress`.
- **Process lifecycle**: the Electron main process (`electron/frpc.cjs`) owns spawn / kill. The `before-quit` hook ensures frpc is gracefully stopped when Desktop exits (`taskkill /T /F` kills the whole tree). When `auto_start` is set, frpc is spawned after Desktop boot; failures only emit `console.warn` and never block Desktop startup.
- **Config persistence**: `server/internal/conf/conf.go` gains a `Frpc *FrpcConfig` field. The Desktop talks to that field via `frpc:conf:get|set` IPC, which reads and writes the same `~/.cj-nantianmen/nantianmen-conf.json` directly — no API call, and every process that reads that file stays in sync automatically.
- **New CLI subcommand `reverse-proxy`** (`download | start | stop | status | config`). `config` accepts multiple `key=value` pairs (`server_addr`, `server_port`, `token`, `remote_port`, `local_port`, `auto_start`). `status` automatically redacts the token (`ab****23`). Config persists into the CLI's own `~/.cj-nantianmen/config.json` (decoupled from the server's conf, so it works without the server running). The help line now lists `reverse-proxy`.
- **Architectural isolation**: FRPC is a fully independent child process; zero code touches the server (it just gains one `FrpcConfig` JSON field) or the proxy path (LLM calls never go through the frp tunnel). If frpc crashes, local `127.0.0.1:38271` access is unaffected.
- **⚠️ Heads-up**: some antivirus products (Defender SmartScreen, 360, AVG, …) flag `frpc.exe` as a potential threat and quarantine it automatically — a known issue with frp, see [issue #3637](https://github.com/fatedier/frp/issues/3637). If you click "Download" and the binary disappears, whitelist `%APPDATA%\cj-nantianmen\frpc\frpc.exe` and click "Download latest FRPC" again.

### Security

- FRPC authenticates to FRPS with a token that is automatically redacted in `status` / `config` output (`ab****cd`). For production deployments we strongly recommend enabling FRPS `tls.force = true` plus an `allowPorts` allowlist.

## [v0.4.24] — 2026-08-11

### Added — Model deletion (Desktop + CLI)
- **Desktop per-model delete button**: Providers.vue adds a red delete button on the right of every model row. The default model button is disabled (40% opacity + tooltip "Cannot delete the default model"); other models pop a confirmation dialog ("This model will be removed from every API Key's authorized list. Any API Key assigned to this model will automatically fall back to Nantianmen-default"), then call `DELETE /api/admin/providers/{id}/models/{modelId}`. Trilingual i18n (`delete_default_forbidden`) added.
- **Server delete route**: new `DELETE /api/admin/providers/{id}/models/{modelId}`. Default model returns 400 `cannot delete default model`; hard-delete calls `modelmap.RebuildModelMap()` so `/v1/models` reflects immediately. Existing schema cascades kick in: `api_key_models.model_id ON DELETE CASCADE` removes the model from every API Key's authorized list; `api_keys.assigned_model_id ON DELETE SET NULL` clears any admin override that targeted this model (proxy falls back to Nantianmen-default); `usage_stats` / `communication_log` historical rows are preserved, `model_id` SET NULL has no effect on cost/usage history.
- **CLI `models` subcommand**: new `models ls <provider-id>` (lists models + capability + ★default/disabled badges) and `models rm <provider-id> <model-id>` (y/N double-confirm). `providers ls` output appends the nested model count (`3 models`) so the operator knows whether to drill down. Help text adds `models`.
- **CLI subcommand args-slicing bug fix**: `main()` previously passed `os.Args[2:]` to subcommand handlers, which counted flag values (e.g. `--port 40999`) as the sub arg, so `providers ls`, `apikey ls`, etc. saw `sub="40999"` and silently returned (exit 0, no output). Switched to `subIdx` recording the sub's position in os.Args and passing `os.Args[subIdx+1:]` — every subcommand benefits.

### Added — Cost persistence + UI cost column
- **Price triple + cost column**: `models` gains `input_price` / `output_price` / `cache_hit_price` (REAL NOT NULL DEFAULT 0); `usage_stats` and `communication_log` each gain `cost REAL NOT NULL DEFAULT 0`. `RebuildModelMap` populates prices at startup; `modelmap.Entry` exposes the triple.
- **Cost computed at proxy end and persisted**: `proxy.go` adds `computeCost(entry, in, out, cached)` using `(uncached_input × input_price + output × output_price + cached × cache_hit_price) / 1M`. Computed value is passed into `stats.Record(...)` / `logEntry` and written to `usage_stats.cost` and `communication_log.cost`. Future price changes do not retroactively rewrite history.
- **Desktop Logs cost column**: Logs.vue gains a "Cost" column after "Hit%"; `fmtCost` rules: `0/null → −`, `<0.0001 → >¥0.0001`, `≥0.0001 → ¥0.XXXX` (4 decimals, ¥ symbol). Trilingual i18n (`log_cost`) added.
- **CLI `stats` breakdown gains cost column**: stats subcommand's total line now prints `cost: $X.XX`; the breakdown table gets a `cost` column (7 columns: provider / model / reqs / in / out / cached / cost). New `toF()` helper converts JSON numbers to float64.

### Fixed
- **FlushBuffer trim misfires wipe communication_log**: in `commlog.go`, `FlushBuffer` ran `TrimToMax(500)` on every flush (10s tick) when `LogRotationEnabled=true && LogRotationMax=0`. Server restart + high-frequency writes caused the oldest rows to be bulk-trimmed — WisUnite (pid=9) 7 rows + other old rows vanished. Fix: remove trim from `FlushBuffer`, move it to an independent `initRotation()` ticker (60s interval), gate changed to `LogRotationEnabled && LogRotationMax > 0`.
- **`runMigrations` dead code**: legacy `UPDATE models SET deleted_at=datetime('now') WHERE deleted=1` referenced a column that does not exist in the schema; Exec silently swallowed the error. Removed; schema uses `deleted_at` only.
- **Desktop `log_cost` i18n key missing**: zh/en/ja translations absent; fallback displays Chinese "花费".

### Migration
- **Existing users**: `runMigrations` auto-adds `cost` columns on startup; new EXE takes effect immediately.
- **Production v0.4.23 databases**: single `ALTER TABLE` + `UPDATE` transaction to backfill historical cost (joined on `model_id = models.id`) without stopping the server:
  ```sql
  ALTER TABLE usage_stats ADD COLUMN cost REAL NOT NULL DEFAULT 0;
  ALTER TABLE communication_log ADD COLUMN cost REAL NOT NULL DEFAULT 0;
  UPDATE usage_stats SET cost = ROUND(
    (input_tokens - cached_tokens) * m.input_price / 1000000.0
    + output_tokens * m.output_price / 1000000.0
    + cached_tokens * m.cache_hit_price / 1000000.0, 6)
  FROM models m WHERE usage_stats.model_id = m.id
    AND (m.input_price > 0 OR m.output_price > 0 OR m.cache_hit_price > 0);
  -- Same shape for communication_log. Models with price=0 keep cost=0.
  ```
- **WisUnite historical data recovery**: the v0.4.23 trim bug deleted 256 rows of communication_log from the 33-minute window before backup (including all 7 WisUnite rows). After deploying 0.4.24, recovery uses `ATTACH DATABASE '<backup>.db' AS bkp` + INSERT with explicit column list (cost defaults to 0), then reruns the backfill SQL to populate cost. Rows that fell outside the backup window cannot be recovered (WAL tombstone).

## [v0.4.23] — 2026-08-03

### Fixed
- **streaming + tool_call parameter loss**: v0.4 Go server's `parseTokens` function would panic on slice bounds out of range when an SSE chunk contained unterminated `{...` JSON, triggering chi.Recoverer to close the HTTP connection and causing tool_calls delta / finish_reason / `[DONE]` to all be lost. Symptom: when a client streams with tool_choice=required, tool_calls.arguments was always an empty string. Fix: one-line guard `if depth != 0 || end >= len(text) { return }` added after the bracket-matching loop at line 304-317. Verified 100% fixed with MiniMax-M3 + Deepseek-V4-Pro.
- **user_id formatted as "3.0"**: `proxy.go:logEntry` used `fmt.Sprintf("%d.0", id)` to write api_key IDs as "3.0" into communication_log.user_id (TEXT column), causing log management and stats to display "3.0" / "Key #3". Fix: store user_id as int64, change column type from TEXT to INTEGER, add auto-migration to clean old "N.0" data on startup.
- **API Key name cleared on model assign/unassign**: `router.go` PUT `/api/admin/api-keys/{id}` parsed `name`/`note` as Go empty string (not nil), causing `COALESCE(?, name)` to overwrite existing names with empty string. Fix: add `stringOrNil()` helper — when name is not provided in the request, pass nil so COALESCE preserves the existing value.

## [v0.4.21] — 2026-08-02

### Changed — Go rewrite of server/CLI (dual-track 3-6 months)
- **server/ (new Go implementation)**: server rewritten in Go 1.26.3 with chi/v5 router and modernc.org/sqlite (pure Go, no cgo); cross-compile friendly; HTTP router keeps the same `/v1/*` and `/api/admin/*` endpoints as the Node server, DB schema 100% compatible with v0.3.15
- **CLI switched to Go binary**: `server/cmd/nantianmen/` ships the Go CLI (`ClientVersion = 0.4.21`); strict version handshake — exits with code 1 if server version does not match
- **Desktop spawns Go server**: `desktop/electron/main.cjs` now uses `child_process.spawn` to launch `extraResources/server/nantianmen-server.exe` with env `NANTIANMEN_LOCAL_MODE=1` to bypass admin auth; `before-quit` hook sends SIGTERM to the Go child
- **Version unified across three components**: desktop `0.4.21` / Go server `ServerVersion = 0.4.21` / Go CLI `ClientVersion = 0.4.21` / `cli/package.json` `0.4.21`; legacy Node server (`server/`) stays at `0.3.15` running in parallel
- **PE icon embedded**: both Go binaries use `rsrc -ico nantianmen.ico -arch amd64 -o icon.syso` and `go build` auto-links the .syso; Windows Explorer shows the dedicated icon

### Why Go
- **Simpler deployment**: single static binary; cross-compile produces Linux/macOS/Windows in one command — no Node, no node-gyp, no better-sqlite3 native build chain on user machines
- **Lower memory footprint**: ~30-50 MB peak (Node 14/16 typically 80-150 MB at the same throughput)
- **Faster startup**: ~150 ms vs Node ~1-2 s (Desktop shows "Server online" almost immediately on cold launch)
- **No cgo cross-platform**: modernc.org/sqlite is pure-Go SQLite; Windows MSI/DMG installers no longer depend on the MSVC redistributable
- **CLI distribution**: previously Node CLI needed `bun --compile` to produce a single-file EXE; Go CLI is just `GOOS=windows go build`

### Added
- **`POST /v1/embeddings` end-to-end verified**: LMStudio `text-embedding-nomic-embed-text-v1.5@f16` (model.id=859), 768-dim vectors, 2 inputs; DB writes `usage_stats` (`request_count=1`, `input_tokens/output_tokens/cached_tokens` all 0) and `communication_log` (raw text in `input`, `{embedding_dim, embedding_count, model, usage}` meta in `output`)
- **CLI `stats --capability=chat|embedding|all`**: Go CLI stats filter by model capability (default `all`), mirroring the Desktop top select
- **Desktop Stats top select "Model Type"**: `all / chat / embedding` (default `all`), persisted via the existing `getUiFilters` storage (same `saveUiFilters` interface as other selects)

### Fixed
- **`-D <db_path>` flag actually overrides conf**: previously the flag was silently ignored because `conf.SetPaths` stored the path in a package variable that `LoadConf` overwrote; now the flag is re-applied after `LoadConf`, default DB path `C:/Users/ASUS/.cj-nantianmen/nantianmen.db`
- **`NANTIANMEN_LOCAL_MODE=1` env lets Go server skip admin auth**: a package-level `var localMode bool` is now initialized from the env via `func init()` in `router.go`, matching `server/auth.js` behavior in the Node server; Desktop spawn no longer needs to send a Bearer token
- **SSE stream missing `\n\n` separator**: `bufio.Scanner` splits on `\n\n` and strips the delimiter; the Go proxy now writes back the trailing `\n\n` so OpenAI SDK clients can parse events correctly
- **SSE stream missing `data: [DONE]`**: original code only injected `[DONE]` on the anthropic→openai conversion path; the openai→openai path (e.g. MiniMax-M3) now also writes `data: [DONE]\n\n` to avoid the client's `Provider returned an empty stream with no finish_reason` error
- **`communication_log` INSERT NOT NULL failures**: the sparse `logEntry` map did not set `user_id / time / request_id`, and Go prepared statements do not honor schema `DEFAULT ''`; `FlushBuffer` now zeroes nil fields and marshals map fields to JSON strings for TEXT columns — fixes both chat and embedding paths simultaneously
- **PE icon embedding**: Go binaries previously had no Windows resource table; now both contain RT_ICON(14) + RT_GROUP_ICON(12)
- **SSE scanner buffer 64KB→8MB**: DeepSeek thinking blocks exceeded `bufio.Scanner`'s default 64KB cap, causing truncation. Bumped to 8MB (per-request allocation, GC'd on response completion)

### Migration
- **New installs**: download `releases/nantianmen-0.4.21-win-x64.exe` (Desktop) / `nantianmen-server-0.4.21-win-x64.exe` (standalone server) / `nantianmen-cli-0.4.21-win-x64.exe` (CLI). DB path stays at `C:/Users/ASUS/.cj-nantianmen/nantianmen.db` — no data migration required.
- **Existing v0.3.15 users**: keep using `releases/nantianmen-0.3.15-win-x64.exe`; both servers share the same DB during the 3-6 month dual-track period. Switching the CLI to the Go binary unlocks `--capability` filtering immediately.

## [v0.3.15] — 2026-07-29

### Added
- **`POST /v1/embeddings` proxy** — OpenAI-format Embeddings passthrough, OpenAI-protocol providers only; `assigned_model_id` does not apply, `body.model` must be explicit (no `auto` / `Nantianmen-default`), Anthropic protocol returns `400 embedding only supports openai protocol`; auth shares `authApiKey` + `checkModelAuthorized`; billing counts only `prompt_tokens`, `output_tokens` / `cached_tokens` recorded as 0; `communication_log.output` stores only metadata `{model, dim, count, format, tokens}` — vector body is never written to SQLite to prevent 1024-dim × N-call bloat
- **`capability` model field** — `models.capability TEXT NOT NULL DEFAULT 'chat' CHECK(capability IN ('chat','embedding'))` (SQLite ALTER TABLE refuses CHECK, legacy DBs get the column without CHECK and rely on application-layer enforcement in `proxyEmbeddingRequest` / `api.addModel`); ALTER is idempotent, server startup auto-migrates existing DBs without manual SQL
- **Providers.vue UI** — Add Model Modal gains a capability single-select radio (chat selected by default); the model list now shows a chat/embedding tag after the model name (embedding: blue `bg-blue-500/20 text-blue-300`; chat: muted gray `bg-gray-700 text-gray-400`)
- **CLI `provider model-add`** — prompts `Capability (chat|embedding) [chat]:`, accepts `embedding` or `e`, empty input defaults to chat; `provider models` list output gains the capability column
- **i18n keys (zh/en/ja)** — added `fld_capability` / `cap_chat` / `cap_embedding`
- **docs/api.md + docs/api-en.md** — new `/v1/embeddings` section (auth, provider limits, billing, curl example, JSON response, error codes)
- **docs/cli.md + docs/cli-en.md** — `provider model-add` description extended with the capability prompt

### Migration
- `models` table gains `capability TEXT NOT NULL DEFAULT 'chat'` column (idempotent ALTER); existing models default to 'chat' and `/v1/chat/completions` / `/v1/messages` behavior is unchanged
- **No manual SQL required**; server startup detects and ALTERs automatically

## [v0.2.14] — 2026-07-19

### Added

- **API key model authorization**: admin can grant model lists per key; `/v1/chat/completions` and `/v1/messages` return `403 model not authorized` for ungranted models.
- **Authorization management UI**: multi-select model grants, auth count badge (button style, always visible including 0), select-all/deselect-all, assigned_model pick from authorized list. Click badge to open edit modal.
- **Available-model filtering**: `GET /api/admin/api-keys/available-models` excludes disabled/deleted models (existing grants are not revoked).
- **DB auto-cleanup**: detects legacy schema columns (`deleted`/`assigned_model`) on startup, backfills `deleted_at`/`assigned_model_id`, then DROPs legacy columns. Desktop splash window and CLI show `[ntm-cleanup] start/done` progress.
- **CLI auth interaction**: `apikey new` interactive multi-select; `apikey edit --auth=<id,...>` / `--assigned=<id>` flag mode; `apikey ls` shows auth count; `provider add` duplicate name check.

### Changed

- **model_id foreign key refactor**: `usage_stats`/`communication_log`/`api_keys` now use FK to models table; model rename automatically reflects via JOIN (single source of truth).
- **Soft delete**: `providers`/`models` gain `deleted_at` column replacing old `deleted` INTEGER. Legacy columns auto-dropped on first startup.
- **Single model resolution entry**: `resolveEntryFor()` in `modelMap.js`, shared by `llmProxy.js` and auth check to prevent drift.
- **i18n cleanup**: removed 14 unused i18n keys (zh/en/ja parity, including `assign_model_hint`/`auth_count_label`/`tray_*`).
- API docs synced (`ApiDocs.vue` v0.2.14 endpoint descriptions and examples).

### Fixed

- **User-management SQL referencing removed `assigned_model` column**: After the migration dropped `api_keys.assigned_model`, `routes/apikey.js` GET/POST/PUT and `services/llmProxy.js` still read the legacy column, making `/api/admin/api-keys` return 500. Switched to LEFT JOIN `models` reading `model_name` aliased as `assigned_model`; added `server/test_apikey_routes.js` as a regression script.
- **Silent Server/Client version mismatch**: `/v1/health` now returns `version`; Desktop `electron/serverCompatibility.cjs` centralizes handshake evaluation; on mismatch the main panel shows "Server/Desktop Version Mismatch" and refuses to load business pages, and the tray reports `Version mismatch`. CLI runs the handshake for every command except `help/quit` and exits with code 1 listing both versions on mismatch. LLM `/v1/*` third-party calls are unaffected by Client version.
- **build-mac workflow artifact filename drift**: CI did not sync `desktop/package.json` version, so pushed tag names did not match DMG filenames. Added a "Sync version from tag" step so `nantianmen-*-mac-*.dmg` matches the tag.

## [v0.2.13] — 2026-07-18

### Changed

- **Version bump**: v0.2.12 → v0.2.13.

## [v0.2.12] — 2026-07-18

### Fixed

- **Streaming duration_ms astronomical values**: `makeStreamingResponse` passed TTFB milliseconds as a timestamp into `Date.now() - ttfbMs`, causing all streaming requests to record ~17 trillion ms durations ([#50](https://github.com/Jiangcat8301/cj-nantianmen/issues/50)).
- **t0 relocation**: TTFB clock starts right before `fetch()` instead of function entry, excluding DB query / protocol conversion overhead.

### Changed

- Log page duration red threshold: 1s → 5s.
- **Unified data directory**: `~/.cj-nantianmen/` — cross-platform data path for server/cli/desktop.
- Dropped `communication_log.json` legacy migration code (`commlog.js` -40 lines).

## [v0.2.11] — 2026-07-18

### Added

- **iconfont UI icon system**: Replaced all emojis with custom iconfont (24 icons) — nav, dashboard copy, provider actions, api-key show/hide/assign, log view/copy. Font file bundled into CSS.
- **API docs example cards**: Each endpoint now has an example card with icon-copy button for one-click curl copy.
- **API Key assigned model modal**: Added icon-assign button per api-key row with centered model picker modal (650px wide). Persisted to `api_keys.assigned_model`. Backend `getAssignedEntry()` routes requests to the assigned model first.
- **Proxy settings**: System settings now has proxy configuration — three modes (system/direct/custom), persisted to `nantianmen-conf.json`. `direct` bypasses any system proxy; `custom` accepts http(s)/socks5 URLs. Powered by undici ProxyAgent with lazy import for Electron fork compatibility.
- **Log duration column**: TTFB (Nantianmen request dispatch → LLM first response byte), stored as `communication_log.duration_ms`. Desktop Logs.vue displays right-aligned, >1s in red. CLI `log ls` outputs `dur` column.
- **Loading animation**: Log page shows a blurred-backdrop spinning ring (`backdrop-blur + animate-spin`) during load/pagination, with i18n (加载中…/Loading…/読み込み中…).
- **CLI proxy subcommand**: `nantianmen proxy` to view current mode; `nantianmen proxy set <system|direct|custom> [url]` to switch. Parity with desktop.
- **CLI log header row**: `nantianmen log ls` now prints a header line (time/user/provider/model/in/out/cached/duration/status).
- **Multi-resolution .ico**: `nantianmen.ico` contains 7 sizes (16/24/32/48/64/128/256) in Vista+ PNG-in-ICO format, 241 KB. Embedded in EXE resources.
- **macOS CI** (`.github/workflows/build-mac.yml`): Push `v*.*.*` tag auto-builds x64 + arm64 DMG, uploads artifacts to release.

### Changed

- **titlebar upgrade**: Height 40px, logo 20×20 px.
- **Global nowrap**: `button`, `td`, `th` all use `white-space: nowrap` to prevent line breaks.
- **Stats top cards**: Height 400→350px.
- **iconfont import**: Changed from `@import` (postcss warning) to `main.js` `import './iconfont.css'`, 0 warnings.
- **Duration calculation**: Now measured at fetch response header time (TTFB), not the full round-trip.

### Fixed

- **PUT /api-keys/:id 500 Internal Server Error**: SELECT used double-quoted `"localtime"` (treated as column reference by SQLite → `no such column`). Fixed to single-quoted `'localtime'`.
- **Server crash on Electron fork**: `proxyDispatcher.js` now lazy-imports `undici`; silent fallback (undefined dispatcher = fetch default) when the module isn't resolvable in the Electron-embedded server.
- **Taskbar icon missing**: `BrowserWindow.icon` changed from PNG to multi-resolution .ico, taskbar now displays correctly.
- **System tray icon**: Now uses `nantianmen.ico` multi-resolution format; Windows auto-picks the best size.

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
