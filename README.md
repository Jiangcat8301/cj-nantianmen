# 南天门 (NANTIANMEN)

> **一钥通万仙，协议自在行**
>
> *One Key to Summon All Models, Protocols Bent to Will*

[![Status](https://img.shields.io/badge/status-v0.4.21--alpha-blueviolet)]()
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
[![Backend](https://img.shields.io/badge/backend-Go%201.26%20%2B%20chi%2Fv5-00ADD8)]()
[![DB](https://img.shields.io/badge/db-SQLite3%20%2B%20modernc.org%2Fsqlite-003B57)]()
[![Desktop](https://img.shields.io/badge/desktop-Electron%2033-47848F)]()
[![CLI](https://img.shields.io/badge/CLI-Go%20binary-00ADD8)]()
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)]()

当使用的供应商和模型较多时，即便通过外部工具，频繁修改各种智能体、应用的配置文件，切换不同情境下使用的模型，也是一件非常"不优雅"且"极其麻烦"的事情。我作了这个小工具，希望提供一个快速、简单、可审计地一站式供应商和模型切换方式。

在中国神话中，**南天门**是天界与人间的唯一通道--众仙出入凡间，必经此门。
南天门不裁断是非，只做一件事：**验明来者身份，放行该放的人，拦住该拦的妖。**

**本系统即以此为喻**：每个 AI Agent 带着南天门签发的令牌（`skm-` Key）来到门前，
声明要找哪位"仙"（Provider + Model），南天门验明令牌、翻译来者的"语言"（协议转换），
放行请求到对应仙府，再将回话翻译回来。全程记录谁找了谁、说了多少话。

> 一句话：**一个本地网关，让所有 Agent 用任何协议访问任何 LLM，中间的翻译和记账它全包了。**

> 🚀 **[v0.4.21](https://github.com/Jiangcat8301/cj-nantianmen/releases/tag/v0.4.21) 已发布** — 2026-08-02。**Go 重写 server + CLI**，Desktop spawn Go server，OpenAI Embeddings 端到端验证，5 bug 修复。详见 [CHANGELOG](./CHANGELOG.md)。
>
> | 产物 | 平台 | 架构 | 大小 | SHA-256 | 下载 |
> | --- | --- | --- | --- | --- | --- |
> | Desktop | Windows | x64 | 83.6 MB | `2ccf0880...` | [下载](https://github.com/Jiangcat8301/cj-nantianmen/releases/download/v0.4.21/nantianmen-0.4.21-win-x64.exe) |
> | Server (standalone) | Windows | x64 | 17.0 MB | `fd195114...` | [下载](https://github.com/Jiangcat8301/cj-nantianmen/releases/download/v0.4.21/nantianmen-server-v0.4.21-win-x64.exe) |
> | CLI | Windows | x64 | 9.1 MB | `5f9f8349...` | [下载](https://github.com/Jiangcat8301/cj-nantianmen/releases/download/v0.4.21/nantianmen-cli-v0.4.21-win-x64.exe) |
> | Server | macOS arm64 | — | 16.0 MB | — | [下载](https://github.com/Jiangcat8301/cj-nantianmen/releases/download/v0.4.21/nantianmen-server-v0.4.21-mac-arm64) |
> | Server | macOS x64 | — | 16.7 MB | — | [下载](https://github.com/Jiangcat8301/cj-nantianmen/releases/download/v0.4.21/nantianmen-server-v0.4.21-mac-x64) |
> | CLI | macOS arm64 | — | 8.3 MB | — | [下载](https://github.com/Jiangcat8301/cj-nantianmen/releases/download/v0.4.21/nantianmen-cli-v0.4.21-mac-arm64) |
> | CLI | macOS x64 | — | 8.9 MB | — | [下载](https://github.com/Jiangcat8301/cj-nantianmen/releases/download/v0.4.21/nantianmen-cli-v0.4.21-mac-x64) |

---

## 🆕 v0.4.21 — Go 重写

v0.4.21 起 server 和 CLI 用 **Go 1.26 + chi/v5 + modernc.org/sqlite (pure Go)** 重写。Node 版本（v0.3.15）双轨运行 3-6 个月观察稳定性。

### 为什么 Go

| 维度 | Node v0.3.15 | **Go v0.4.21** |
|---|---|---|
| 部署 | 双文件 (`server/index.js` + `node_modules`) | **单文件 static binary** |
| 内存峰值 | 80-150 MB | **30-50 MB** |
| 冷启动 | 1-2 秒 | **~150 毫秒** |
| 跨平台 | 需目标平台装 Node + npm i | **cross-compile 一行命令** |
| 原生依赖 | better-sqlite3 (需 node-gyp + MSVC) | **modernc.org/sqlite (pure Go, 无 cgo)** |
| CLI 产物 | `bun build --compile` | **`go build` 直出** |
| 图标 | Electron 自动 | **`rsrc -ico` → .syso 自动 link** |

### 兼容性

- HTTP 端点 (`/v1/*`、`/api/admin/*`) 与 v0.3.15 **完全一致**
- DB schema **100% 兼容**，共用同一份 `C:/Users/<you>/.cj-nantianmen/nantianmen.db`
- Desktop / CLI / Server **三端版本统一** `0.4.21`，握手校验不一致即拒绝
- 旧 v0.3.15 EXE 可继续用，DB 不冲突

### Desktop 集成

Desktop 内嵌 Go server binary 到 `extraResources/server/`，启动时 `child_process.spawn` 拉起，env `NANTIANMEN_LOCAL_MODE=1` 跳过 admin auth（Desktop 不需要发 Bearer），关闭时 SIGTERM 收尾。

---

## ☰ 卷首 · 何谓南天门

> 道教天界正门，诸天仙神、三界生灵觐见天庭的唯一官方通道，由四大天王、天兵轮值镇守，负责核验仙箓、甄别往来访客，阻隔邪祟私自闯入，是天界对外唯一出入口，载于《无上秘要》与传统天界规制体系。

**南天门 (NANTIANMEN)** 是一个**本地化多协议 LLM 代理网关**。
任何 Agent（Hermes / OpenClaw / Codex / 脚本）都可通过 OpenAI 或 Anthropic 协议接入，
由南天门将请求转发到已注册的 LLM Provider（OpenAI / Anthropic / 火山引擎 / 任何兼容服务）。

当 Agent 使用的协议与 Provider 不一致时，南天门自动进行**协议转换**（请求体 + 流式 SSE 实时转换），
响应以流式透传（SSE pipe-through）原样返回，不缓冲、不截断。

两个管理入口：

- **Admin API** (`/api/admin/*`) - Provider / API Key / Stats / 设置/认证/数据库切换，供 Desktop 和 CLI 调用
- **LLM Proxy API** (`/v1/*`) - Agent 请求入口，兼容 OpenAI Chat Completions 与 Anthropic Messages

**首次启动**：server 自动创建 `nantianmen-conf.json`（sqlite3 + 本机 host/port + 管理员密码自动设为 `admin`）。改密码走 `POST /api/admin/password/change`。

**共享数据目录**：三端统一写到家目录下的 `~/.cj-nantianmen/`（cli/desktop/server 全部共享同一份 `nantianmen-conf.json` + `nantianmen.db`）：

| OS | 路径 |
|---|---|
| Windows | `C:\Users\<you>\.cj-nantianmen\` |
| macOS | `/Users/<you>/.cj-nantianmen/` |
| Linux | `/home/<you>/.cj-nantianmen/` |

conf + db 文件在此目录。`-c/-D` 显式指定任意位置仍生效（dev 用法）。

## 架构（v0.4.21）

```
cj-nantianmen/
├── server/         # Go 服务端（pure Go，chi/v5 + modernc.org/sqlite）
│   ├── cmd/nantianmen-server/  # 入口
│   └── internal/               # api / commlog / conf / db / llm / modelmap / stats
├── cli/            # Go CLI（纯 stdlib，单文件）
│   └── main.go
├── desktop/        # Electron + Vue3 + Vite + Tailwind 桌面管理
│   └── electron/main.cjs # spawn nantianmen-server.exe
└── releases/       # 构建产物（不入 repo）
nantianmen-conf.json          # host/port/password/salt/log_enabled/database/window_state
nantianmen.db                 # SQLite 数据文件（默认，含 communication_log 表）
communication_log.json        # 通信日志（v0.2.7 之前的旧文件，首次启动会被自动迁移到 nantianmen.db 后删除）
~/.cj-nantianmen/config.json  # CLI 客户端缓存（host/port/password_md5）
```

### 三组件职责

| 组件 | 语言 | 启动方式 | conf+db 落点 |
|------|------|---------|----------|
| **server** | Go 1.26 + chi/v5 + modernc.org/sqlite | `cd server && go build -o ../releases/nantianmen-server.exe ./cmd/nantianmen-server/` | 同上（`~/.cj-nantianmen/`） |
| **desktop** | Electron 33 + Vue3 + Vite | `cd desktop && npm install && npm run electron:dev` | 同上（`~/.cj-nantianmen/`） |
| **cli** | Go (stdlib) | `cd cli && go build -o ../releases/nantianmen-cli.exe .` | 同上（探测 127.0.0.1:38271，未起则 spawn） |

**共同规则**：`nantianmen-conf.json` 与 `nantianmen.db` 永远落在 `~/.cj-nantianmen/`，由 server 内 `defaultBaseDir()` 决定（直接取 `os.homedir()` + `.cj-nantianmen`，跨平台一致）。`-c/-D` 显式传任意位置仍生效。

### 通信流程

```
Agent ──(skm-xxx, Authorization: Bearer *** Server
                                                          │
                                            ┌─────────────┴─────────────┐
                                            │ O(1) 内存模型 map          │
                                            │ md5(M+salt) admin auth     │
                                            │ OpenAI ⇄ Anthropic 协议转换 │
                                            │ SSE 流式转换 (Anthropic→OpenAI) │
                                            │ 模型授权检查 (v0.2.14)     │
                                            └─────────────┬─────────────┘
                                                          ▼
                                                  LLM Provider
```

admin 客户端：

```
CLI / Desktop ──(Bearer M=md5(pwd))──► /api/admin/*
```

## API 文档

详细端点列表参见 [docs/api.md](./docs/api.md)。

## CLI 文档

详细命令清单参见 [docs/cli.md](./docs/cli.md)。

## 快速开始

### Server

```bash
cd server
go build -o ../releases/nantianmen-server.exe ./cmd/nantianmen-server/
# 启动后监听 http://127.0.0.1:38271，路由全部可用
```

### CLI

```bash
cd cli
go build -o ../releases/nantianmen-cli.exe .
nantianmen-cli.exe setup           # 无 server 时自动 spawn；写入 host/port/db/admin password
nantianmen-cli.exe health          # 探测 server（未运行则 spawn）
nantianmen-cli.exe provider ls     # 列 provider
```

### Desktop

```bash
cd desktop
npm install
npm run electron:dev          # dev：spawn server binary，conf+db 写到 user-data/cj-nantianmen/
npm run electron:build        # 出包到 ../releases/nantianmen-0.4.21-win-x64.exe
# 双击 Nantianmen.exe，conf+db 落到 ~/.cj-nantianmen/（持久）
```

## 技术栈

| 层 | 技术 |
|----|------|
| 后端 | Go 1.26 + chi/v5 + modernc.org/sqlite (pure Go) |
| 前端 | Electron / Vue 3 / Vite / Tailwind CSS |
| CLI | Go (stdlib) |
| 数据库 | SQLite3 (modernc.org/sqlite，pure-Go 实现) |
| 配置 | 单文件 JSON，常驻内存 |

## 安全性

- 管理 API 用 `Bearer M` 认证，`M = md5(RAWPASSWORD)`。server 不存原始密码。
- 管理员密码 server 侧存储为 `md5(md5(RAWPASSWORD) + salt)`。salt 是首次启动随机生成的 6 位 `[A-Za-z0-9]`，每次改密码都重生成，旧 md5 立刻失效。
- 服务监听 `0.0.0.0` 时所有 `/api/admin/*` 与 `/v1/chat/*` 都要求带 Token（无 Token 直接 401）。`/v1/health` 公开。
- Provider 的 API Key 仅 server 端使用，admin API 列表时做 `1234...efgh` 遮盖。
- **v0.2.14 新增**：API Key 模型授权系统，调用未授权的模型返回 `403 model not authorized`。

## Provider 命名约束

- Provider 名称不允许包含**空格**
- Provider 名称不允许包含**下划线 `_`**
- 模型名可包含下划线。模型 ID 格式 `{provider}_{model}`。
- 端点：OpenAI base_url 末尾含 `/v1`，Anthropic base_url 不含 `/v1`。

## 测试

```bash
# Go server: build + vet
cd server && go build ./... && go vet ./...
```

## 兼容性

- Windows / Linux / macOS
- Go 1.23+（server + CLI）
- Electron 33+（Desktop）

## License

MIT
