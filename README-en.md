# Nantianmen (南天门)

> **One Key to Summon All Models, Protocols Bent to Will**

[![Status](https://img.shields.io/badge/status-v0.4.23--alpha-blueviolet)]()
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

> 🚀 **[v0.5.1](https://github.com/Jiangcat8301/cj-nantianmen/releases/tag/v0.5.1) released** — 2026-09-01. See [CHANGELOG](./CHANGELOG.md).
>
> | Asset | Platform | Arch | Size | SHA-256 | Download |
> | --- | --- | --- | --- | --- | --- |
> | Desktop | Windows | x64 | 83.5 MB | `c68ac557891b96f4bc99b8be4695c89bb98934cf44e1d546b4f35f87d40cb0ea` | [Download](https://github.com/Jiangcat8301/cj-nantianmen/releases/download/v0.5.1/nantianmen-0.5.1-win-x64.exe) |
> | Server (standalone) | Windows | x64 | 17.0 MB | `d2e8cb0d0fd2442480ae34b18ca001314ec5ddfcb30c1a2eb20b08f19906af57` | [Download](https://github.com/Jiangcat8301/cj-nantianmen/releases/download/v0.5.1/nantianmen-server-0.5.1-win-x64.exe) |
> | CLI | Windows | x64 | 9.3 MB | `ba3afcda0705007a5cac6681c4e9439c32224dff25c1c028756bbf17d721f534` | [Download](https://github.com/Jiangcat8301/cj-nantianmen/releases/download/v0.5.1/nantianmen-cli-0.5.1-win-x64.exe) |
> | Desktop | macOS | arm64 | 117.0 MB | `f84ab4b7fd5f3424504b4bdc805bd907464c4fc7bf81823126fc938eb3b3eea2` | [Download](https://github.com/Jiangcat8301/cj-nantianmen/releases/download/v0.5.1/nantianmen-0.5.1-mac-arm64.dmg) |
> | Server (standalone) | macOS | arm64 | 16.0 MB | `63e0439f090b4ec066a497e5c4d68604b38554f350fd050222bf3d131893171d` | [Download](https://github.com/Jiangcat8301/cj-nantianmen/releases/download/v0.5.1/nantianmen-server-0.5.1-mac-arm64) |
> | CLI | macOS | arm64 | 8.5 MB | `3f2177d1d607ee857f9e960dccc8f49e2934ac0f0ff19714fa4b59447a97939a` | [Download](https://github.com/Jiangcat8301/cj-nantianmen/releases/download/v0.5.1/nantianmen-cli-0.5.1-mac-arm64) |

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

## Architecture (v0.4.23)

```
cj-nantianmen/
├── server/         # Go server (pure Go, chi/v5 + modernc.org/sqlite)
│   ├── cmd/nantianmen-server/  # entrypoint
│   └── internal/               # api / commlog / conf / db / llm / modelmap / stats
├── cli/            # Go CLI (stdlib, single file)
│   └── main.go
├── desktop/        # Electron + Vue3 + Vite + Tailwind desktop UI
│   └── electron/main.cjs # spawn nantianmen-server
└── releases/       # Build artifacts (not in repo)
nantianmen-conf.json          # host/port/password/salt/log_enabled/database/window_state
nantianmen.db                 # SQLite file (default; includes communication_log table)
communication_log.json        # Legacy comm log (pre-v0.2.7); auto-migrated to nantianmen.db on first run, then deleted
~/.cj-nantianmen/config.json  # CLI client-side state
```

### Three Components

| Component | Language | Startup |
|-----------|----------|---------|
| **server** | Go 1.26 + chi/v5 + modernc.org/sqlite | `cd server && go build -o ../releases/nantianmen-server.exe ./cmd/nantianmen-server/` |
| **desktop** | Electron 33 + Vue3 + Vite | `cd desktop && npm install && npm run electron:dev` |
| **cli** | Go (stdlib) | `cd cli && go build -o ../releases/nantianmen-cli.exe .` |

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

## Public-Internet Tunneling (v0.5.0+)

Nantianmen only listens on `127.0.0.1:38271` by default. To expose it to the public internet, the Desktop and CLI integrate [FRPC](https://github.com/fatedier/frp) as an independent child process:

- **Desktop**: open the "Reverse Proxy" sidebar page → first visit, click "Download latest FRPC" (auto-pulls the platform-appropriate binary from GitHub releases and extracts it into `userData/frpc/`) → fill in the FRPS address / port / token / remote port / local port → "Start FRPC".
- **CLI**: `nantianmen reverse-proxy download`, `nantianmen reverse-proxy config key=value ...`, `nantianmen reverse-proxy start | stop | status`.

When `auto_start` is enabled, Desktop boots also spawn frpc; on Desktop exit `taskkill /T /F` kills the whole tree. FRPC is fully independent — its crash does not affect local `127.0.0.1:38271` access.

⚠️ Some antivirus products (Defender SmartScreen, 360, AVG, …) flag `frpc.exe` as a potential threat and quarantine it automatically — a known issue with frp, see [issue #3637](https://github.com/fatedier/frp/issues/3637). If the binary disappears after download, whitelist `%APPDATA%\cj-nantianmen\frpc\frpc.exe` and click "Download latest FRPC" again. For production deployments we recommend FRPS `tls.force = true` plus an `allowPorts` allowlist.

## API Reference

Full endpoint list: see [docs/api-en.md](./docs/api-en.md).

## CLI Reference

Full command list: see [docs/cli-en.md](./docs/cli-en.md).

## Quick Start

### Server

```bash
cd server
go build -o ../releases/nantianmen-server.exe ./cmd/nantianmen-server/
# Listens on http://127.0.0.1:38271, all routes active
```

### CLI

```bash
cd cli
go build -o ../releases/nantianmen-cli.exe .
nantianmen-cli.exe setup           # writes host/port/db/admin password
nantianmen-cli.exe health          # check server status
nantianmen-cli.exe provider ls     # list providers
```

### Desktop

```bash
cd desktop
npm install
npm run electron:dev          # dev: spawns server binary
npm run electron:build        # outputs ../releases/nantianmen-0.4.23-win-x64.exe
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Go 1.26 + chi/v5 + modernc.org/sqlite (pure Go) |
| Frontend | Electron / Vue 3 / Vite / Tailwind CSS |
| CLI | Go (stdlib) |
| Database | SQLite3 (modernc.org/sqlite, pure-Go implementation) |
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
# Go server: build + vet
cd server && go build ./... && go vet ./...
```

## Compatibility

- Windows / Linux / macOS
- Go 1.23+ (server + CLI)
- Electron 33+ (Desktop)

## License

MIT
