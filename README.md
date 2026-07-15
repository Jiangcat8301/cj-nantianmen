# 南天门 (NANTIANMEN)

> **一钥通万仙，协议自在行**
>
> *One Key to Summon All Models, Protocols Bent to Will*

[![Status](https://img.shields.io/badge/status-v0.2.0--alpha-blueviolet)]()
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
[![Backend](https://img.shields.io/badge/backend-Node.js%2022%20%2B%20Fastify-339933)]()
[![DB](https://img.shields.io/badge/db-SQLite3%20%2B%20(better--sqlite3)-003B57)]()
[![Desktop](https://img.shields.io/badge/desktop-Electron%2033-47848F)]()
[![CLI](https://img.shields.io/badge/CLI-Node.js%20(no%20deps)-339933)]()
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)]()

在中国神话中，**南天门**是天界与人间的唯一通道--众仙出入凡间，必经此门。
南天门不裁断是非，只做一件事：**验明来者身份，放行该放的人，拦住该拦的妖。**

**本系统即以此为喻**：每个 AI Agent 带着南天门签发的令牌（`skm-` Key）来到门前，
声明要找哪位"仙"（Provider + Model），南天门验明令牌、翻译来者的"语言"（协议转换），
放行请求到对应仙府，再将回话翻译回来。全程记录谁找了谁、说了多少话。

> 一句话：**一个本地网关，让所有 Agent 用任何协议访问任何 LLM，中间的翻译和记账它全包了。**

---

## ☰ 卷首 · 何谓南天门

**南天门 (NANTIANMEN)** 是一个**本地化多协议 LLM 代理网关**。
任何 Agent（Hermes / OpenClaw / Codex / 脚本）都可通过 OpenAI 或 Anthropic 协议接入，
由南天门将请求转发到已注册的 LLM Provider（OpenAI / Anthropic / 火山引擎 / 任何兼容服务）。

当 Agent 使用的协议与 Provider 不一致时，南天门自动进行**协议转换**（4 条转换路径），
响应以流式透传（SSE pipe-through）原样返回，不缓冲、不截断。

两个管理入口：

- **Admin API** (`/api/admin/*`) - Provider / API Key / Stats / 设置/认证/数据库切换，供 Desktop 和 CLI 调用
- **LLM Proxy API** (`/v1/*`) - Agent 请求入口，兼容 OpenAI Chat Completions 与 Anthropic Messages

**首次启动需 setup**：调用 `POST /api/admin/setup` 填入 host、port、数据库类型和管理员密码，server 才启用数据库路由并接受后续管理请求。

## 架构（v0.2）

```
cj-nantianmen/
├── server/         # Node.js Fastify 后端，可独立运行；与 desktop 共享一个进程
│   ├── conf.js           # nantianmen-conf.json 单点配置 + 内存常驻
│   ├── auth.js           # Bearer M 校验（md5(md5(pwd) + salt)）
│   ├── index.js          # 入口：监听 + register routes
│   ├── db/               # Database 抽象层 + SQLite3 实现 + MySQL impl（占位）
│   ├── routes/           # admin / llm / provider / apikey
│   └── services/         # provider / modelMap / llmProxy / protocol / stats
├── desktop/        # Electron + Vue3 + Vite + Tailwind 桌面管理
│   └── electron/main.js  # fork `server/index.js`（v0.2 无需 Python）
├── cli/            # 单文件 Node.js CLI（无第三方依赖）
│   ├── index.js          # subcommand dispatch + 解析 -P/--password
│   └── prompt.js         # TTY / piped stdin 两种模式
└── build/          # 构建产物（不入 repo）

首次 setup 后会创建：
nantianmen-conf.json          # server 同目录，host/port/password/salt/database
nantianmen.db                 # SQLite 数据文件（默认）
~/.nantianmen/config.json     # CLI 客户端保存的 host/port/password_md5
```

### 三组件职责

| 组件 | 语言 | 启动方式 |
|------|------|---------|
| **server** | Node.js (Fastify + better-sqlite3) | `cd server && npm install && node index.js` |
| **desktop** | Node.js (Electron + Vue3) | `cd desktop && npm install && npm run electron:dev` |
| **cli** | Node.js (stdlib) | `cd cli && node index.js <command>` |

### 通信流程

```
Agent ──(skm-xxx, Authorization: Bearer skm-xxx)──► Server
                                                          │
                                            ┌─────────────┴─────────────┐
                                            │ O(1) 内存模型 map          │
                                            │ md5(M+salt) admin auth     │
                                            │ OpenAI ⇄ Anthropic 协议转换 │
                                            │ SSE 流式透传               │
                                            └─────────────┬─────────────┘
                                                          ▼
                                                  LLM Provider
```

admin 客户端：

```
CLI / Desktop ──(Bearer M=md5(pwd))──► /api/admin/*
```

## Admin API 端点

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| GET  | `/api/admin/status` | 公开 | 返回 `initialized` 标志 |
| POST | `/api/admin/setup` | 公开（仅未初始化） | 首次启动初始化 |
| POST | `/api/admin/login` | 公开（仅已初始化） | 验证保存的 md5 是否仍可工作 |
| POST | `/api/admin/password/change` | Bearer M | 改密码 + 重生成 salt（**旧密码立即失效**） |
| POST | `/api/admin/database/configure` | Bearer M | 切换 DB 后端（需 restart） |
| GET/PUT | `/api/admin/settings` | Bearer M | 读/写 host + port |
| GET/POST/PUT/DELETE | `/api/admin/providers` | Bearer M | Provider CRUD |
| POST | `/api/admin/providers/:id/refresh-models` | Bearer M | 重新拉取 Provider 模型列表 |
| POST | `/api/admin/providers/:id/models` | Bearer M | 手动添加 model 名称 |
| GET/POST/PUT/DELETE | `/api/admin/api-keys` | Bearer M | API Key CRUD |
| GET  | `/api/admin/stats` | Bearer M | 用量聚合（SUM） |
| POST | `/api/admin/server/{shutdown,restart}` | Bearer M | 进程控制 |

管理 API 除白名单外都要求：

```
Authorization: Bearer M
其中 M = md5(RAWPASSWORD)，server 端校验 md5(M + conf.salt) == conf.password
```

## LLM Proxy API

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| GET  | `/v1/health` | 公开 | 健康检查 + active_requests |
| GET  | `/v1/models` | Bearer `skm-` | 模型列表（`{name}_{protocol}_{model}` 格式） |
| POST | `/v1/chat/completions` | Bearer `skm-` | OpenAI Chat Completions 入口 |
| POST | `/v1/messages` | Bearer `skm-` | Anthropic Messages 入口 |

## CLI

```bash
# 首次初始化（交互式）
nantianmen setup

# 健康检查
nantianmen health
nantianmen -H 127.0.0.1 --port 38271 health

# 改密码（内部 md5 后传 server；old + new ×2）
nantianmen -P 'oldpass' password

# 管理
nantianmen provider ls
nantianmen provider add
nantianmen apikey new
nantianmen stats

# 全局 flags 解析顺序：--flag > $NANTIANMEN_* > ~/.nantianmen/config.json > 报错
```

## 快速开始

### Server

```bash
cd server
npm install
node index.js
# 首次启动：仅监听 /v1/health 与 /api/admin/status
# 通过 CLI 完成 setup（推荐）：
cd ../cli && node index.js setup
# 或手动 curl：
curl -X POST http://127.0.0.1:38271/api/admin/setup \
  -H 'Content-Type: application/json' \
  -d '{"host":"0.0.0.0","port":38271,"password_md5":"<md5(管理员密码)>","database":{"type":"sqlite3","path":"./nantianmen.db"}}'
```

Server 默认监听 `http://0.0.0.0:38271`。

### CLI

```bash
cd cli
node index.js setup           # 写入 host/port/db/admin password
node index.js health          # 验证 server 状态
node index.js provider ls     # 列 provider
```

### Desktop

```bash
cd desktop
npm install
npm run electron:dev
# 首次启动 fork server/index.js 并打开管理界面
```

## 技术栈

| 层 | 技术 |
|----|------|
| 后端 | Node.js 22+ / Fastify 4 / better-sqlite3 / Node fetch |
| 前端 | Electron / Vue 3 / Vite / Tailwind CSS |
| CLI | Node.js (stdlib only) |
| 数据库 | SQLite3 (WAL，better-sqlite3 同步 binding) |
| 配置 | 单文件 JSON，常驻内存 |

## 安全性

- 管理 API 用 `Bearer M` 认证，`M = md5(RAWPASSWORD)`。server 不存原始密码。
- 管理员密码 server 侧存储为 `md5(md5(RAWPASSWORD) + salt)`。salt 是首次启动随机生成的 6 位 `[A-Za-z0-9]`，每次改密码都重生成，旧 md5 立刻失效。
- 服务监听 `0.0.0.0` 时所有 `/api/admin/*` 与 `/v1/chat/*` 都要求带 Token（无 Token 直接 401）。`/v1/health` 公开。
- Provider 的 API Key 仅 server 端使用，admin API 列表时做 `1234...efgh` 遮盖。

## Provider 命名约束

- Provider 名称不允许包含**空格**
- Provider 名称不允许包含**下划线 `_`**
- 模型名可包含下划线。模型 ID 格式 `{provider}_{protocol}_{model}`，前两个 `_` 切分（`split('_', 2)` 不足以切三分 -- 前两个 `_` 作 boundary，modelname 可含下划线）。
- 端点：OpenAI base_url 末尾含 `/v1`，Anthropic base_url 不含 `/v1`。

## 测试

```bash
# server 单元测试（20 步全过）
cd server && node test_setup.js

# CLI 端到端测试（10 步全过，包含 password 全链路验证）
cd ../tools && node run-cli-e2e.js
```

CLI e2e 实测覆盖：

- wrong password 被服务端 401 拒绝
- 修改密码后旧 md5 + 旧 salt 哈希失效
- 新 password 在新 salt 下生效
- 重启后 auth 持久化到 `nantianmen-conf.json`

## 兼容性

- Windows / Linux / macOS
- Node.js 22+（必需；Server 与 CLI 都用 fetch API）
- Electron 33+（Desktop）

## License

MIT
