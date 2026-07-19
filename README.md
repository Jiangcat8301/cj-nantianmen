# 南天门 (NANTIANMEN)

> **一钥通万仙，协议自在行**
>
> *One Key to Summon All Models, Protocols Bent to Will*

[![Status](https://img.shields.io/badge/status-v0.2.14--alpha-blueviolet)]()
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
[![Backend](https://img.shields.io/badge/backend-Node.js%2022%20%2B%20Fastify-339933)]()
[![DB](https://img.shields.io/badge/db-SQLite3%20%2B%20(better--sqlite3)-003B57)]()
[![Desktop](https://img.shields.io/badge/desktop-Electron%2033-47848F)]()
[![CLI](https://img.shields.io/badge/CLI-Node.js%20%2B%20Bun%20compile-339933)]()
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)]()

当使用的供应商和模型较多时，即便通过外部工具，频繁修改各种智能体、应用的配置文件，切换不同情境下使用的模型，也是一件非常"不优雅"且"极其麻烦"的事情。我作了这个小工具，希望提供一个快速、简单、可审计地一站式供应商和模型切换方式。

在中国神话中，**南天门**是天界与人间的唯一通道--众仙出入凡间，必经此门。
南天门不裁断是非，只做一件事：**验明来者身份，放行该放的人，拦住该拦的妖。**

**本系统即以此为喻**：每个 AI Agent 带着南天门签发的令牌（`skm-` Key）来到门前，
声明要找哪位"仙"（Provider + Model），南天门验明令牌、翻译来者的"语言"（协议转换），
放行请求到对应仙府，再将回话翻译回来。全程记录谁找了谁、说了多少话。

> 一句话：**一个本地网关，让所有 Agent 用任何协议访问任何 LLM，中间的翻译和记账它全包了。**

> 🚀 **[v0.2.14](https://github.com/Jiangcat8301/cj-nantianmen/releases/tag/v0.2.14) 已发布** — 2026-07-19。模型授权系统 + DB 自动清理 + 未授权 403。详见 [CHANGELOG](./CHANGELOG.md)。 [下载 Windows EXE](https://github.com/Jiangcat8301/cj-nantianmen/releases/download/v0.2.14/nantianmen-0.2.14-win-x64.exe) (x64) | [下载 macOS DMG](https://github.com/Jiangcat8301/cj-nantianmen/releases/tag/v0.2.14) (x64 + arm64)

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

## 架构（v0.2.3）

```
cj-nantianmen/
├── server/         # Node.js Fastify 后端，可独立运行；与 desktop 共享一个进程
│   ├── conf.js           # nantianmen-conf.json 单点配置 + 内存常驻
│   ├── auth.js           # Bearer M 校验（md5(md5(pwd) + salt)）
│   ├── index.js          # 入口：监听 + register routes
│   ├── db/               # Database 抽象层 + SQLite3 实现 + MySQL impl（占位）
│   ├── routes/           # admin / llm / provider / apikey
│   └── services/         # provider / modelMap / llmProxy / protocol / stats / commlog
├── desktop/        # Electron + Vue3 + Vite + Tailwind 桌面管理
│   └── electron/main.cjs # fork server/index.js（v0.2 无需 Python）
├── cli/            # 单文件 Node.js CLI（无第三方依赖）
│   ├── index.js          # subcommand dispatch + 解析 -P/--password
│   └── prompt.js         # TTY / piped stdin 两种模式
└── releases/       # 构建产物（不入 repo）

首次启动会创建（跨平台 user-data 子目录 `cj-nantianmen/`，由 launcher 决定写入；可在 Desktop Settings 改路径）：
nantianmen-conf.json          # host/port/password/salt/log_enabled/database/window_state
nantianmen.db                 # SQLite 数据文件（默认，含 communication_log 表）
communication_log.json        # 通信日志（v0.2.7 之前的旧文件，首次启动会被自动迁移到 nantianmen.db 后删除）
~/.cj-nantianmen/config.json  # CLI 客户端缓存（host/port/password_md5）
```

### 三组件职责

| 组件 | 语言 | 启动方式 | conf+db 落点 |
|------|------|---------|----------|
| **server** | Node.js (Fastify + better-sqlite3) | `cd server && npm install && node index.js [-c conf -D db]` | user-data 子目录 `cj-nantianmen/`，无 flag 时 |
| **desktop** | Node.js (Electron + Vue3) | `cd desktop && npm install && npm run electron:dev` | 同上（`~/.cj-nantianmen/`） |
| **cli** | Node.js (stdlib) + Bun compile | `cd cli && node index.js <command>` 或 `nantianmen-cli-*.exe` | 同上（探测 127.0.0.1:38271，未起则 fork） |

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
npm install
node index.js [-c conf -D db]    # 默认：conf+db 在 user-data/cj-nantianmen/
# 启动后监听 http://127.0.0.1:38271，路由全部可用
```

### CLI

```bash
cd cli
node index.js setup           # 无 server 时自动启动一份；写入 host/port/db/admin password
node index.js health          # 探测 server（未运行则 fork）
node index.js provider ls     # 列 provider

# 或使用编译好的 exe
nantianmen-cli-0.2.3-win-x64.exe setup
```

### Desktop

```bash
cd desktop
npm install
npm run electron:dev          # dev：fork ../server，conf+db 写到 user-data/cj-nantianmen/
npm run electron:build        # 出包到 ../releases/nantianmen-0.2.14-win-x64.exe
# 双击 Nantianmen.exe，conf+db 落到 ~/.cj-nantianmen/（持久）
```

## 技术栈

| 层 | 技术 |
|----|------|
| 后端 | Node.js 22+ / Fastify 4 / better-sqlite3 / Node fetch |
| 前端 | Electron / Vue 3 / Vite / Tailwind CSS |
| CLI | Node.js (stdlib) + Bun compile 出 exe |
| 数据库 | SQLite3 (WAL，better-sqlite3 同步 binding) |
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
# server 单元测试（20 步全过）
cd server && node test_setup.js

# CLI 端到端测试（10 步全过，包含 password 全链路验证）
cd ../tools && node run-cli-e2e.js
```

## 兼容性

- Windows / Linux / macOS
- Node.js 22+（必需；Server 与 CLI 都用 fetch API）
- Electron 33+（Desktop）

## License

MIT
