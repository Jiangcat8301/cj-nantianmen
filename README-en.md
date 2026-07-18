# Nantianmen (南天门)

> **One Key to Summon All Models, Protocols Bent to Will**

[![Status](https://img.shields.io/badge/status-v0.2.12--alpha-blueviolet)]()
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
[![Backend](https://img.shields.io/badge/backend-Node.js%2022%20%2B%20Fastify-339933)]()
[![DB](https://img.shields.io/badge/db-SQLite3%20%2B%20(better--sqlite3)-003B57)]()
[![Desktop](https://img.shields.io/badge/desktop-Electron%2033-47848F)]()
[![CLI](https://img.shields.io/badge/CLI-Node.js%20%2B%20Bun%20compile-339933)]()
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)]()

With so many providers and models in use, constantly tweaking config files across agents and applications—even with external helpers—to change models for different scenarios is not only **inelegant** but also a **huge hassle**. That’s why I created this little tool: to provide a **quick, easy, auditable, all‑in‑one** solution for switching providers and models.

In Chinese mythology, **Nantianmen** (南天门) is the sole gateway between Heaven and the mortal realm--all immortals must pass through this gate when descending to the world of mortals.
Nantianmen does not judge right or wrong; it does one thing: **verify the identity of those who come, let the worthy pass, and bar the unworthy.**

**This system takes its name from that metaphor.** Every AI Agent arrives at the gate carrying a token issued by Nantianmen (an `skm-` Key),
declaring which "immortal" (Provider + Model) it wishes to consult. Nantianmen verifies the token, translates the visitor's "language" (protocol conversion),
forwards the request to the corresponding celestial court, and translates the response back. All the while, it records who sought whom and how much was said.

> One sentence: **a local gateway that lets every Agent access any LLM using any protocol — translation and accounting, all in one box.**

> 🚀 **[v0.2.12](https://github.com/Jiangcat8301/cj-nantianmen/releases/tag/v0.2.12) released** — 2026-07-18. Fixed streaming duration astronomical bug, precise TTFB timing, duration red threshold 1s→5s. See [CHANGELOG](./CHANGELOG-en.md). [Download Windows EXE](https://github.com/Jiangcat8301/cj-nantianmen/releases/download/v0.2.12/nantianmen-0.2.12-win-x64.exe) (x64, 79 MB) | [Download macOS DMG](https://github.com/Jiangcat8301/cj-nantianmen/releases/tag/v0.2.12) (x64 + arm64)

---

## ☰ Overview · What is Nantianmen

**Nantianmen (南天门)** is a **local multi-protocol LLM proxy gateway**.
Any Agent (Hermes / OpenClaw / Codex / scripts) can connect via OpenAI or Anthropic protocol,
and Nantianmen forwards the request to a registered LLM Provider (OpenAI / Anthropic / Volcengine ARK / any compatible service).

When the Agent's protocol differs from the Provider's, Nantianmen automatically performs **protocol conversion** (request body + real-time SSE conversion).
Responses are streamed through (SSE pipe-through) without buffering or truncation.

Two management interfaces:

- **Admin API** (`/api/admin/*`) - Provider / API Key / Stats / settings / database switch, consumed by Desktop and CLI
- **LLM Proxy API** (`/v1/*`) - Agent request entry, compatible with OpenAI Chat Completions and Anthropic Messages

**First-time startup**: server auto-creates `nantianmen-conf.json` (sqlite3 + localhost + admin password defaults to `admin`). Change password via `POST /api/admin/password/change`.

**Shared data directory**: all three launchers write to the same cross-platform user-data subdirectory `cj-nantianmen`:

| OS | Path |
|---|---|
| Windows | `%APPDATA%\Roaming\cj-nantianmen\` |
| macOS | `~/Library/Application Support/cj-nantianmen/` |
| Linux | `~/.config/cj-nantianmen/` (XDG) |

conf + db files live here. `-c/-D` flags override for custom paths.

## Architecture (v0.2.3)

```
cj-nantianmen/
├── server/         # Node.js Fastify backend, runs independently; shared with desktop
│   ├── conf.js           # nantianmen-conf.json single-file config + memory-resident
│   ├── auth.js           # Bearer M check: md5(md5(pwd) + salt)
│   ├── index.js          # entry: listen + register routes
│   ├── db/               # Database abstraction + SQLite3 impl + MySQL impl (placeholder)
│   ├── routes/           # admin / llm / provider / apikey
│   └── services/         # provider / modelMap / llmProxy / protocol / stats / commlog
├── desktop/        # Electron + Vue3 + Vite + Tailwind desktop UI
│   └── electron/main.cjs # fork server/index.js (v0.2 dropped Python)
├── cli/            # Single-file Node.js CLI (no third-party deps)
│   ├── index.js          # subcommand dispatch + parse -P/--password
│   └── prompt.js         # TTY / piped stdin modes
└── releases/       # Build artifacts (not in repo)

After first startup, created files:
nantianmen-conf.json          # host/port/password/salt/log_enabled/database/window_state
nantianmen.db                 # SQLite file (default)
communication_log.json        # comm log (when log_enabled=true)
~/.nantianmen/config.json     # CLI client-side state
```

### Three Components

| Component | Language | Startup |
|-----------|----------|---------|
| **server** | Node.js (Fastify + better-sqlite3) | `cd server && npm install && node index.js [-c conf -D db]` |
| **desktop** | Node.js (Electron + Vue3) | `cd desktop && npm install && npm run electron:dev` |
| **cli** | Node.js (stdlib) + Bun compile | `cd cli && node index.js <command>` or `nantianmen-cli-*.exe` |

### Communication Flow

```
Agent ──(skm-xxx, Authorization: Bearer *** Server
                                                     │
                                       ┌─────────────┴─────────────┐
                                       │ O(1) in-memory model map   │
                                       │ md5(M+salt) admin auth     │
                                       │ OpenAI ⇄ Anthropic convert │
                                       │ SSE streaming conversion   │
                                       └─────────────┬─────────────┘
                                                     ▼
                                             LLM Provider
```

Admin client:

```
CLI / Desktop ──(Bearer M=md5(pwd))──► /api/admin/*
```

## Admin API Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/admin/status` | public | Returns `initialized` flag |
| POST | `/api/admin/setup` | public (uninitialized only) | First-time initialization |
| POST | `/api/admin/login` | public (initialized only) | Verify saved md5 still works |
| POST | `/api/admin/password/change` | Bearer M | Change password + regenerate salt |
| POST | `/api/admin/database/configure` | Bearer M | Switch DB backend (restart required) |
| GET/PUT | `/api/admin/settings` | Bearer M | Read/write host + port |
| GET/POST/PUT/DELETE | `/api/admin/providers` | Bearer M | Provider CRUD |
| PUT | `/api/admin/providers/:id/models/:mid/default` | Bearer M | Set default model |
| PUT | `/api/admin/providers/:id/models/:mid` | Bearer M | Edit model pricing |
| POST | `/api/admin/providers/:id/models/refresh` | Bearer M | Re-fetch provider model list |
| POST | `/api/admin/providers/:id/models` | Bearer M | Manually add a model name |
| GET/POST/DELETE | `/api/admin/api-keys` | Bearer M | API key CRUD |
| GET | `/api/admin/stats` | Bearer M | Usage aggregation (`?range=today\|7d\|30d`) |
| GET | `/api/admin/default-model` | Bearer M | Get default routing model |
| GET | `/api/admin/communication-log` | Bearer M | Query comm log (`?provider_id=&model_name=&user_id=`) |
| DELETE | `/api/admin/communication-log` | Bearer M | Clear comm log |
| GET/PUT | `/api/admin/communication-log/config` | Bearer M | Log toggle |
| POST | `/api/admin/server/{shutdown,restart}` | Bearer M | Process control |

All admin endpoints except the whitelist require:

```
Authorization: Bearer ***
where M = md5(RAWPASSWORD); server checks md5(M + conf.salt) == conf.password
```

## LLM Proxy API

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/v1/health` | public | Health check + active_requests |
| GET | `/v1/models` | Bearer `skm-` | Model list (`{name}_{model}` format) |
| POST | `/v1/chat/completions` | Bearer `skm-` | OpenAI Chat Completions entry |
| POST | `/v1/messages` | Bearer `skm-` | Anthropic Messages entry |

> When Provider protocol differs from inbound protocol, streaming responses are real-time converted (Anthropic SSE ↔ OpenAI SSE). No Agent-side adaptation needed.

## CLI

```bash
# First-time setup
nantianmen setup

# Health check
nantianmen health

# Change password
nantianmen -P 'oldpass' password

# Provider & model management
nantianmen provider ls
nantianmen provider add
nantianmen provider models <pid>            # list models with pricing
nantianmen provider models-refresh <pid>    # refresh from upstream
nantianmen provider model-add <pid> <name>  # add manually
nantianmen provider model-edit <pid> <mid> --input=0.1 --output=0.5 --cache=0.01
nantianmen provider default <pid> <mid>     # set as default

# API Keys
nantianmen apikey new
nantianmen apikey ls

# Stats (with range filter)
nantianmen stats --range=today

# Communication log
nantianmen log ls [--provider ID] [--model NAME] [--user ID]
nantianmen log enable|disable|clear|config

# Settings
nantianmen settings                        # view
nantianmen settings set --port=8380        # change port

# Global flag resolution: --flag > $NANTIANMEN_* > ~/.nantianmen/config.json > error
```

## Quick Start

### Server

```bash
cd server
npm install
node index.js [-c conf -D db]
# Listens on http://127.0.0.1:38271, all routes active
```

### CLI

```bash
cd cli
node index.js setup           # writes host/port/db/admin password
node index.js health          # check server status
node index.js provider ls     # list providers

# Or use compiled exe
nantianmen-cli-0.2.3-win-x64.exe setup
```

### Desktop

```bash
cd desktop
npm install
npm run electron:dev          # dev: forks ../server
npm run electron:build        # outputs ../releases/nantianmen-0.2.3-win-x64.exe
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js 22+ / Fastify 4 / better-sqlite3 / Node fetch |
| Frontend | Electron / Vue 3 / Vite / Tailwind CSS |
| CLI | Node.js (stdlib) + Bun compile |
| Database | SQLite3 (WAL, better-sqlite3 sync binding) |
| Config | Single JSON file, memory-resident |

## Security

- Admin API uses `Bearer M` where `M = md5(RAWPASSWORD)`; raw password never reaches server.
- Admin password is stored as `md5(md5(RAWPASSWORD) + salt)`. Salt is a 6-char `[A-Za-z0-9]` random string generated on first setup. Password change regenerates the salt, immediately invalidating the old md5.
- Server listens on `0.0.0.0`; all `/api/admin/*` and `/v1/chat/*` require a Token (no Token → 401). `/v1/health` is public.
- Provider API keys are server-side only; admin API list responses mask them as `1234...efgh`.

## Provider Naming Constraints

- Provider name must not contain **spaces**
- Provider name must not contain **underscores `_`**
- Model name may contain underscores. Model ID format `{provider}_{model}`.
- Endpoint layout: OpenAI base_url ends with `/v1`; Anthropic base_url does not.

## Tests

```bash
# Server unit tests (20/20 PASS)
cd server && node test_setup.js

# CLI end-to-end (10/10 PASS, covers password chain)
cd ../tools && node run-cli-e2e.js
```

## Compatibility

- Windows / Linux / macOS
- Node.js 22+ (required; both Server and CLI use native fetch)
- Electron 33+ (Desktop)

## License

MIT
