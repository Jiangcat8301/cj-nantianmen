# Nantianmen

> Multi-protocol LLM proxy gateway for unified multi-provider, multi-model request forwarding and protocol conversion.

## Overview

Nantianmen is a locally-run LLM proxy gateway. It receives large model requests from various agents (compatible with both OpenAI and Anthropic protocols), forwards them to the corresponding LLM provider based on the user-selected model, and returns results to the agent. When the agent's protocol differs from the provider's, Nantianmen automatically performs protocol conversion.

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
