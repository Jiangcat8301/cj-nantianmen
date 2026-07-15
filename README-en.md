# Nantianmen (南天门)

> **One Key to Summon All Models, Protocols Bent to Will**

[![Status](https://img.shields.io/badge/status-v0.2.0--alpha-blueviolet)]()
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
[![Backend](https://img.shields.io/badge/backend-Node.js%2022%20%2B%20Fastify-339933)]()
[![DB](https://img.shields.io/badge/db-SQLite3%20%2B%20(better--sqlite3)-003B57)]()
[![Desktop](https://img.shields.io/badge/desktop-Electron%2033-47848F)]()
[![CLI](https://img.shields.io/badge/CLI-Node.js%20(no%20deps)-339933)]()
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)]()

In Chinese mythology, **Nantianmen** (南天门) is the sole gateway between Heaven and the mortal realm--all immortals must pass through this gate when descending to the world of mortals.
Nantianmen does not judge right or wrong; it does one thing: **verify the identity of those who come, let the worthy pass, and bar the unworthy.**

**This system takes its name from that metaphor.** Every AI Agent arrives at the gate carrying a token issued by Nantianmen (an `skm-` Key),
declaring which "immortal" (Provider + Model) it wishes to consult. Nantianmen verifies the token, translates the visitor's "language" (protocol conversion),
forwards the request to the corresponding celestial court, and translates the response back. All the while, it records who sought whom and how much was said.

> In one sentence: **a local gateway that lets any Agent access any LLM using any protocol--it handles all translation and accounting in between.**

---

## ☰ Overview · What is Nantianmen

**Nantianmen (南天门)** is a **local multi-protocol LLM proxy gateway**.
Any Agent (Hermes / OpenClaw / Codex / scripts) can connect via OpenAI or Anthropic protocol,
and Nantianmen forwards the request to a registered LLM Provider (OpenAI / Anthropic / Volcengine ARK / any compatible service).

When the Agent's protocol differs from the Provider's, Nantianmen automatically performs **protocol conversion** (4 conversion paths).
Responses are streamed through (SSE pipe-through) without buffering or truncation.

Two management interfaces:

- **Admin API** (`/api/admin/*`) - Provider / API Key / Stats / settings / database switch, consumed by Desktop and CLI
- **LLM Proxy API** (`/v1/*`) - Agent request entry, compatible with OpenAI Chat Completions and Anthropic Messages

**First-time setup required**: call `POST /api/admin/setup` with host, port, database backend, and admin password. Only after that does the server enable DB-backed routes.

## Architecture (v0.2)

```
cj-nantianmen/
├── server/         # Node.js Fastify backend, runs independently; shared with desktop
│   ├── conf.js           # nantianmen-conf.json single-file config + memory-resident
│   ├── auth.js           # Bearer M check: md5(md5(pwd) + salt)
│   ├── index.js          # entry: listen + register routes
│   ├── db/               # Database abstraction + SQLite3 impl + MySQL impl (placeholder)
│   ├── routes/           # admin / llm / provider / apikey
│   └── services/         # provider / modelMap / llmProxy / protocol / stats
├── desktop/        # Electron + Vue3 + Vite + Tailwind desktop UI
│   └── electron/main.js  # fork server/index.js (v0.2 dropped Python)
├── cli/            # Single-file Node.js CLI (no third-party deps)
│   ├── index.js          # subcommand dispatch + parse -P/--password
│   └── prompt.js         # TTY / piped stdin modes
└── build/          # Build artifacts (not in repo)

After first setup, created files:
nantianmen-conf.json          # next to server exe: host/port/password/salt/database
nantianmen.db                 # SQLite file (default)
~/.nantianmen/config.json     # CLI client-side state
```

### Three Components

| Component | Language | Startup |
|-----------|----------|---------|
| **server** | Node.js (Fastify + better-sqlite3) | `cd server && npm install && node index.js` |
| **desktop** | Node.js (Electron + Vue3) | `cd desktop && npm install && npm run electron:dev` |
| **cli** | Node.js (stdlib) | `cd cli && node index.js <command>` |

### Communication Flow

```
Agent ──(skm-xxx, Authorization: Bearer skm-xxx)──► Server
                                                     │
                                       ┌─────────────┴─────────────┐
                                       │ O(1) in-memory model map   │
                                       │ md5(M+salt) admin auth     │
                                       │ OpenAI ⇄ Anthropic convert │
                                       │ SSE streaming passthrough  │
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
| POST | `/api/admin/password/change` | Bearer M | Change password + regenerate salt (**old password immediately invalid**) |
| POST | `/api/admin/database/configure` | Bearer M | Switch DB backend (restart required) |
| GET/PUT | `/api/admin/settings` | Bearer M | Read/write host + port |
| GET/POST/PUT/DELETE | `/api/admin/providers` | Bearer M | Provider CRUD |
| POST | `/api/admin/providers/:id/refresh-models` | Bearer M | Re-fetch provider model list |
| POST | `/api/admin/providers/:id/models` | Bearer M | Manually add a model name |
| GET/POST/PUT/DELETE | `/api/admin/api-keys` | Bearer M | API key CRUD |
| GET | `/api/admin/stats` | Bearer M | Usage aggregation (SUM) |
| POST | `/api/admin/server/{shutdown,restart}` | Bearer M | Process control |

All admin endpoints except the whitelist require:

```
Authorization: Bearer M
where M = md5(RAWPASSWORD); server checks md5(M + conf.salt) == conf.password
```

## LLM Proxy API

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/v1/health` | public | Health check + active_requests |
| GET | `/v1/models` | Bearer `skm-` | Model list (`{name}_{protocol}_{model}`) |
| POST | `/v1/chat/completions` | Bearer `skm-` | OpenAI Chat Completions entry |
| POST | `/v1/messages` | Bearer `skm-` | Anthropic Messages entry |

## CLI

```bash
# First-time setup (interactive)
nantianmen setup

# Health check
nantianmen health
nantianmen -H 127.0.0.1 --port 38271 health

# Change password (md5'd internally before sending; interactive old + new ×2)
nantianmen -P 'oldpass' password

# Management
nantianmen provider ls
nantianmen provider add
nantianmen apikey new
nantianmen stats

# Global flag resolution: --flag > $NANTIANMEN_* > ~/.nantianmen/config.json > error
```

## Quick Start

### Server

```bash
cd server
npm install
node index.js
# First start: only /v1/health and /api/admin/status are live
# Complete setup via CLI (recommended):
cd ../cli && node index.js setup
# or manual curl:
curl -X POST http://127.0.0.1:38271/api/admin/setup \
  -H 'Content-Type: application/json' \
  -d '{"host":"0.0.0.0","port":38271,"password_md5":"<md5(admin password)>","database":{"type":"sqlite3","path":"./nantianmen.db"}}'
```

Server default: `http://0.0.0.0:38271`.

### CLI

```bash
cd cli
node index.js setup           # writes host/port/db/admin password
node index.js health          # check server status
node index.js provider ls     # list providers
```

### Desktop

```bash
cd desktop
npm install
npm run electron:dev
# First launch forks server/index.js and opens the GUI
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js 22+ / Fastify 4 / better-sqlite3 / Node fetch |
| Frontend | Electron / Vue 3 / Vite / Tailwind CSS |
| CLI | Node.js (stdlib only) |
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
- Model name may contain underscores. Model ID format `{provider}_{protocol}_{model}`; the first two `_` are the boundary (since `split('_', 2)` doesn't give three parts, the model name may freely include `_`).
- Endpoint layout: OpenAI base_url ends with `/v1`; Anthropic base_url does not.

## Tests

```bash
# Server unit tests (20/20 PASS)
cd server && node test_setup.js

# CLI end-to-end (10/10 PASS, covers password chain)
cd ../tools && node run-cli-e2e.js
```

CLI e2e verifies:

- Wrong password rejected with 401
- After password change, old md5 + old salt hash fails
- New password + new salt works
- Restart preserves auth (persisted to `nantianmen-conf.json`)

## Compatibility

- Windows / Linux / macOS
- Node.js 22+ (required; both Server and CLI use native fetch)
- Electron 33+ (Desktop)

## License

MIT
