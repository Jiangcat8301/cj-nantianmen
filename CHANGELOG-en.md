# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Project initialization: three-directory architecture (server / desktop / cli)
- Server: Python FastAPI backend scaffold
- Desktop: Electron + Vue3 + Vite + Tailwind CSS frontend scaffold
- CLI: Go static-compiled command-line tool scaffold
- SQLite database schema design (providers / api_keys / models / usage_stats / settings)
- Provider management: CRUD + health check + model listing/caching + default model
- User management: Nantianmen API key generation (`skm-` prefix) / list / delete
- LLM proxy core: OpenAI Chat Completions + Anthropic Messages dual-protocol inbound
- Protocol conversion: 4 conversion paths + streaming passthrough
- Statistics: request count / token usage / cached token distinction
- PID file lock: ensures single server instance
- Cross-platform support: Windows / Linux / macOS
