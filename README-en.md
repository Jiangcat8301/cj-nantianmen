# Nantianmen (南天门)

> **One Key to Summon All Models, Protocols Bent to Will**

[![Status](https://img.shields.io/badge/status-v0.1.0--alpha-blueviolet)]()
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
[![Backend](https://img.shields.io/badge/backend-Python%203.11%20%2B%20FastAPI-3776AB)]()
[![Desktop](https://img.shields.io/badge/desktop-Electron%2033-47848F)]()
[![CLI](https://img.shields.io/badge/CLI-Go%201.21%2B%20(static)-00ADD8)]()
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

- **Admin API** (`/api/admin/*`) - CRUD for Providers / API Keys / Stats, consumed by Desktop and CLI
- **LLM Proxy API** (`/v1/*`) - Agent request entry, compatible with OpenAI Chat Completions and Anthropic Messages

## Architecture

```
cj-nantianmen/
├── server/       # Python FastAPI backend, runs independently
│   └── app/
│       ├── api/       # Routes: admin API + LLM proxy
│       ├── core/      # Config, security, PID lock
│       ├── db/        # SQLite init + WAL
│       ├── models/    # Pydantic schema
│       └── services/  # Provider management, protocol conversion, stats
├── desktop/      # Electron + Vue3 + Vite + Tailwind CSS desktop UI
│   └── src/
│       ├── components/
│       ├── views/
│       └── lib/
├── cli/          # Go static-compiled CLI, feature-parity with UI
│   └── cmd/
└── build/        # Build artifacts (not in repo)
```

### Three Components

| Component | Language | Responsibility |
|-----------|----------|---------------|
| **server** | Python (FastAPI) | HTTP proxy gateway + admin API + SQLite storage + PID file lock |
| **desktop** | TypeScript (Electron+Vue3) | GUI management, controls server via Admin API |
| **cli** | Go (stdlib) | CLI management tool, feature-parity with desktop |

### Communication Flow

```
Agent ──(skm-xxx key)──► Server ──(provider key)──► LLM Provider
                         │
                    ┌────┴────┐
                    │ Protocol  │ OpenAI ⇄ Anthropic
                    │ Conversion│
                    │ Streaming │ SSE pipe-through
                    │ Stats     │ token / request count
                    └─────────┘
```

desktop / cli ──(admin API)──► Server (start/stop/config/query)

## Features

- **Provider Management**: Register multiple LLM providers (OpenAI / Anthropic / compatible services), configure endpoint, API key, protocol
- **Health Check**: Probe provider connectivity and API key validity via `/models` endpoint
- **Model Listing**: Auto-fetch available models from provider, or manually add model names
- **Default Model**: Set a provider+model as default; agents can select `auto` to use it
- **User Management**: Generate Nantianmen API keys (`skm-` prefix) with name and notes
- **Dual-Protocol Inbound**: Compatible with OpenAI Chat Completions and Anthropic Messages
- **Protocol Conversion**: Auto-convert when agent and provider protocols differ (4 conversion paths)
- **Streaming Passthrough**: SSE responses piped through without buffering
- **Statistics**: Track model usage count, request count, upload/download token count (cached tokens distinguished)

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.11+ / FastAPI / uvicorn / httpx / SQLite (WAL) |
| Frontend | Electron / Vue 3 / Vite / Tailwind CSS |
| CLI | Go 1.21+ / stdlib (no third-party deps, CGO_ENABLED=0 static build) |
| Database | SQLite (WAL mode, cross-platform) |

## Quick Start

### Server

```bash
cd server
python -m venv .venv

# Windows
.venv\Scripts\activate
# Linux/macOS
source .venv/bin/activate

pip install -r requirements.txt
python -m app.main
```

Server listens on `http://127.0.0.1:7300` by default.

### Desktop

```bash
cd desktop
npm install
npm run dev
```

### CLI

```bash
cd cli
go build -o nantianmen .
./nantianmen help
```

## API Key

Agents authenticate with Nantianmen API keys (prefixed `skm-`). Provider API keys are stored server-side only and never exposed to agents.

## Compatibility

- Windows / Linux / macOS fully supported
- Go CLI is statically compiled with no external dependencies
- Python Server requires Python 3.11+
- Electron Desktop requires Node.js 18+

## License

MIT
