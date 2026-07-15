# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [v0.2.0] - 2026-07-15

### ⚠ Breaking

- **架构重写：Python → Node.js**。Server 改用 Fastify + better-sqlite3；CLI 改用 Node.js（Go 版移除）；Desktop 内嵌 fork Node.js server（不再 spawn Python uvicorn）。
- **默认端口 7300 → 38271**。监听 host `0.0.0.0`。
- **存储格式变更**：`server/data/nantianmen.db` + `requirements.txt` 全部移除。新增 `nantianmen-conf.json` 存于 exe 同目录，内含 `server_host`、`server_port`、`password`、`salt`、`database` 字段。
- **数据库接入首次需 setup**。`POST /api/admin/setup` 才是创建 schema 的入口；调用过 setup 的 server 才会启用数据库路由。
- **Provider 名称仍不允许空格 / 下划线**（沿用 v0.1 规则）。

### Added

- `nantianmen-conf.json`：单文件配置 + 内存常驻，setup 写、CRUD 不写。`process.stdin.unref()` 保证 Hermes/CI stdin 关闭不触发 server 退出。
- 管理鉴权：请求 header `Authorization: Bearer M`（`M = md5(RAWPASSWORD)`），server 校验 `md5(M + conf.salt)`。
  - `POST /api/admin/setup`（仅未初始化时可用）
  - `POST /api/admin/login`（验证保存的 md5 是否仍生效）
  - `POST /api/admin/password/change`（重生成 salt，旧密码立即失效）
  - `POST /api/admin/database/configure`（DB 后端切换，hot restart 标志）
  - `GET/PUT /api/admin/settings`（host/port）
  - `POST /api/admin/server/{shutdown,restart}`
- DB 抽象层 `db/interface.js` + `db/sqlite.js`（`better-sqlite3`，WAL mode） + `db/mysql.js`（占位 TODO，TypeError when triggered）。
- 数据存储方式首次连接由 setup 选定（SQLite3 / MySQL），后续用 `database/configure` 切换。
- 内存模型 map (`services/modelMap.js`)：启动 / CRUD 时构建，`{name}_{protocol}_{model}` 形式 O(1) 解析，含 endpoint + headers，热路径零 DB 读。
- 流式代理：`undici` 等价 Node 原生 fetch + async iterator；SSE pass-through。
- Token 统计：内存缓冲 + 每 10s 批量 INSERT；`/api/admin/stats` 端点 SUM 聚合查询。

### CLI

新增可执行文件 `nantianmen`，子命令：

| 命令 | 用途 |
| --- | --- |
| `setup` | 交互式初始化（host/port/db/admin password ×2） |
| `login` | 保存新的 admin password 到 `~/.nantianmen/config.json` |
| `database` | 切换 DB 后端（SQLite3 / MySQL） |
| `settings` | 查询 server 实际配置 |
| `password` | 修改 admin password（old / new ×2） |
| `provider {ls\|add\|rm}` | provider CRUD |
| `apikey {new\|ls\|rm}` | API Key CRUD |
| `stats` | 查询 usage 聚合 |
| `restart` / `shutdown` | 控制 server 进程 |

全局 flags: `-H/--host`、`--port`、`-P/--password`（RAW → 内部 md5）。优先级：`--flag > $ENV > ~/.nantianmen/config.json > 报错`。

### Desktop

- `electron/main.js` 改 `fork('./server/index.js')`，去掉 Python venv 检测（`getPythonPath` 删除）。
- 端口常量 `SERVER_PORT = 38271`。
- 现有的设置向导 / 数据存储 UI 由后续版本补齐；当前 v0.2 主要交付 Server + CLI 端到端可用，Desktop 端需用户手动 `nantianmen setup` 完成初始化。

### Removed

- `server/app/`、`server/.venv/`、`server/requirements.txt`、`cli/nantianmen.exe` (Go)。

### Tests

- `server/test_setup.js`：20 步全部通过（setup / restart / login / password change / salt 轮换）。
- `tools/run-cli-e2e.js`：10 步全部通过，**实测 password 生效**：
  - wrong password 被服务端 401 拒绝
  - 修改密码后旧 MD5 + 旧 salt 哈希失效
  - 新 password 在新 salt 下生效

---

## [v0.1.0]

### Added

- 项目初始化：三目录架构（server / desktop / cli）
- Server: Python FastAPI 后端骨架
- Desktop: Electron + Vue3 + Vite + Tailwind CSS 前端骨架
- CLI: Go 静态编译命令行工具骨架
- SQLite schema 设计（providers / api_keys / models / usage_stats / settings）
- Provider CRUD、用户管理、LLM 代理、协议转换、统计、PID 锁
- 跨平台：Windows / Linux / macOS
