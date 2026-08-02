# Nantianmen (南天门)

> **One Key to Summon All Models, Protocols Bent to Will**

[![Status](https://img.shields.io/badge/status-v0.4.21--alpha-blueviolet)]()
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
[![Backend](https://img.shields.io/badge/backend-Go%201.26%20%2B%20chi%2Fv5-00ADD8)]()
[![DB](https://img.shields.io/badge/db-SQLite3%20%2B%20modernc.org%2Fsqlite-003B57)]()
[![Desktop](https://img.shields.io/badge/desktop-Electron%2033-47848F)]()
[![CLI](https://img.shields.io/badge/CLI-Go%20binary-00ADD8)]()
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)]()

With so many providers and models in use, constantly tweaking config files across agents and applications—even with external helpers—to change models for different scenarios is not only **inelegant** but also a **huge hassle**. That's why I created this little tool: to provide a **quick, easy, auditable, all‑in‑one** solution for switching providers and models.

In Chinese mythology, **Nantianmen** (南天门) is the sole gateway between Heaven and the mortal realm--all immortals must pass through this gate when descending to the world of mortals.
Nantianmen does not judge right or wrong; it does one thing: **verify the identity of those who come, let the worthy pass, and bar the unworthy.**

**This system takes its name from that metaphor.** Every AI Agent arrives at the gate carrying a token issued by Nantianmen (an `skm-` Key),
declaring which "immortal" (Provider + Model) it wishes to consult. Nantianmen verifies the token, translates the visitor's "language" (protocol conversion),
forwards the request to the corresponding celestial court, and translates the response back. All the while, it records who sought whom and how much was said.

> One sentence: **a local gateway that lets every Agent access any LLM using any protocol — translation and accounting, all in one box.**

> 🚀 **[v0.4.21](https://github.com/Jiangcat8301/cj-nantianmen/releases/tag/v0.4.21) released** — 2026-08-02. **Go rewrite of server + CLI**, Desktop spawns Go server, OpenAI Embeddings end-to-end verified, 5 bug fixes. See [CHANGELOG](./CHANGELOG-en.md).
>
> | Asset | Platform | Arch | Download |
> | --- | --- | --- | --- |
> | Desktop | Windows | x64 | [nantianmen-0.4.21-win-x64.exe (84 MB)](https://github.com/Jiangcat8301/cj-nantianmen/releases/download/v0.4.21/nantianmen-0.4.21-win-x64.exe) |
> | Server (standalone) | Windows | x64 | [nantianmen-server-0.4.21-win-x64.exe (17 MB)](https://github.com/Jiangcat8301/cj-nantianmen/releases/download/v0.4.21/nantianmen-server-0.4.21-win-x64.exe) |
> | CLI | Windows | x64 | [nantianmen-cli-0.4.21-win-x64.exe (9 MB)](https://github.com/Jiangcat8301/cj-nantianmen/releases/download/v0.4.21/nantianmen-cli-0.4.21-win-x64.exe) |

---

## 🆕 v0.4.21 — Go rewrite

From v0.4.21 the server and CLI are rewritten in **Go 1.26 + chi/v5 + modernc.org/sqlite (pure Go)**. The legacy Node server (v0.3.15) runs in parallel for 3-6 months while we observe stability.

### Why Go

| Dimension | Node v0.3.15 | **Go v0.4.21** |
|---|---|---|
| Deployment | two files (`server/index.js` + `node_modules`) | **single static binary** |
| Memory peak | 80-150 MB | **30-50 MB** |
| Cold start | 1-2 s | **~150 ms** |
| Cross-platform | target machine needs Node + `npm i` | **cross-compile in one command** |
| Native deps | better-sqlite3 (needs node-gyp + MSVC) | **modernc.org/sqlite (pure Go, no cgo)** |
| CLI artifact | `bun build --compile` | **`go build` directly** |
| Icons | Electron handles it | **`rsrc -ico` → .syso auto-linked** |

### Compatibility

- HTTP endpoints (`/v1/*`, `/api/admin/*`) are **identical** to v0.3.15
- DB schema is **100% compatible** — same `C:/Users/<you>/.cj-nantianmen/nantianmen.db` is shared
- Desktop / CLI / Server all **share version `0.4.21`**, handshake rejects mismatches
- The old v0.3.15 EXE keeps working; the DB does not conflict

### Desktop integration

Desktop embeds the Go server binary under `extraResources/server/`. At launch it `child_process.spawn`s the binary with env `NANTIANMEN_LOCAL_MODE=1` to skip admin auth (Desktop never sends a Bearer token); `before-quit` sends SIGTERM to shut it down.

---

## ☰ Overview · What is Nantianmen

> In Taoist cosmology, the Southern Heavenly Gate is the sole official passage through which the celestial gods, spirits, and beings of the three realms appear before the Heavenly Court. It is guarded in rotating shifts by the Four Heavenly Kings and celestial soldiers, who verify immortal registers, screen visitors, and bar evil intrusions — the only external entry to the celestial realm, recorded in the *Wushu Miyi* and the traditional celestial bureaucracy.

**Nantianmen (南天门)** is a **local multi-protocol LLM proxy gateway**.
Any Agent (Hermes / OpenClaw / Codex / scripts) can connect via OpenAI or Anthropic protocol,
and Nantianmen forwards the request to a registered LLM Provider (OpenAI / Anthropic / Volcengine ARK / any compatible service).

When the Agent's protocol differs from the Provider's, Nantianmen automatically performs **protocol conversion** (request body + real-time SSE conversion).
Responses are streamed through (SSE pipe-through) without buffering or truncation.

Two management interfaces:

- **Admin API** (`/api/admin/*`) - Provider / API Key / Stats / settings / database switch, consumed by Desktop and CLI
- **LLM Proxy API** (`/v1/*`) - Agent request entry, compatible with OpenAI Chat Completions and Anthropic Messages

**First-time startup**: server auto-creates `nantianmen-conf.json` (sqlite3 + localhost + admin password defaults to `admin`). Change password via `POST /api/admin/password/change`.

**Shared data directory**: all three launchers write to the same home-directory subdir `~/.cj-nantianmen/` (cli/desktop/server share one `nantianmen-conf.json` + `nantianmen.db`):

| OS | Path |
|---|---|
| Windows | `C:\Users\<you>\.cj-nantianmen\` |
| macOS | `/Users/<you>/.cj-nantianmen/` |
| Linux | `/home/<you>/.cj-nantianmen/` |

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
nantianmen.db                 # SQLite file (default; includes communication_log table)
communication_log.json        # Legacy comm log (pre-v0.2.7); auto-migrated to nantianmen.db on first run, then deleted
~/.cj-nantianmen/config.json  # CLI client-side state
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
                                       │ Model auth check (v0.2.14) │
                                       └─────────────┬─────────────┘
                                                     ▼
                                             LLM Provider
```

Admin client:

```
CLI / Desktop ──(Bearer M=md5(pwd))──► /api/admin/*
```

## API Reference

Full endpoint list: see [docs/api-en.md](./docs/api-en.md).

## CLI Reference

Full command list: see [docs/cli-en.md](./docs/cli-en.md).

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
npm run electron:build        # outputs ../releases/nantianmen-0.2.14-win-x64.exe
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
- **v0.2.14 new**: API key model authorization — calling unauthorized models returns `403 model not authorized`.

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
