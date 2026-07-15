# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [v0.2.4] — 2026-07-15

### Added

- **API Key 编辑**：Desktop 用户管理页新增编辑按钮，支持修改名称和备注；编辑后自动全量替换日志文件中的旧用户名
- **CLI API Key 编辑**：`nantianmen apikey edit <id> <name> <note> [oldName]`

### Fixed

- **统计时区修正**：`stats.query()` 从 `date('now')` (UTC) 改为 `date('now','localtime')`，确保 Dashboard / Stats / Tray 的"今日"以本地 00:00 为起点
- **统计页下拉列表空白**：provider/model 下拉列表现在正确填充已注册的供应商和模型

### Changed

- 导航标签「统计」→「数据统计」

## [v0.2.3] — 2026-07-15

### Added

- **通信日志**：server 端 `services/commlog.js` 记录每次对话的 raw input/output（流式以 `[stop]` 标记结束），JSON 落盘 `communication_log.json`(userData 目录)，上限 1000 条。
  - 日志路由：`GET /api/admin/communication-log`（支持 `?provider_id=&model_name=&user_id=` 过滤）、`DELETE` 清空、`GET/PUT .../config` 开关（`log_enabled` 存入 conf）
  - Desktop: 新增「日志管理」页（左侧导航 📝），启用/清空/过滤/内联展开详情
  - CLI: `nantianmen log [ls|clear|enable|disable|config] [--provider ID] [--model NAME] [--user ID]`
- **SSE 协议转换**：`llmProxy.js` 新增 `anthropicSSEToOpenAI()` —— 当 Agent 用 OpenAI 协议但 Provider 是 Anthropic 协议时，流式响应实时从 Anthropic SSE 格式转换为 OpenAI SSE 格式，解决 Hermes Agent 报 `empty stream with no finish_reason` 的问题。
- **Desktop titlebar 版本号**：服务状态右侧显示 `v0.2.3`
- **Tray 当日统计**：托盘右键菜单显示 📥📤💾💰 当日 token + 消费（15s 轮询）
- **Tray i18n**：托盘菜单支持 zh/en/ja 三语，与 Desktop 语言设置同步
- **CLI 功能对齐**：`provider models/models-refresh/model-add/model-edit/default`、`stats --range=today|7d|30d`、`settings set --port=N`
- **API Docs**：新增 log 相关端点文档

### Changed

- **模型名称格式**：`{name}_{protocol}_{model}` → `{name}_{model}`（去掉了 protocol 段）。内存路由和 `/v1/models` 输出一致。
- **Window state 持久化**：从独立的 `window-state.json` 迁移到 `nantianmen-conf.json` 的 `window_state` 字段
- **Desktop 滚动条**：全局自定义暗色细滚动条（WebKit + Firefox）
- **Desktop 日志列表**：最新记录在上，增加「缓存命中」列，过滤标签改为「全部供应商/全部用户」
- **Desktop 协议 tag 配色**：Provider 列表和概览页的协议 tag —— OpenAI 蓝色、Anthropic 橘黄色
- **Desktop 模型管理**：价格字体增大，默认模型说明改为中文规则，复制模型名格式同步为新格式
- **Tray 菜单**：移除启动/停止服务选项

### Fixed

- **SSE 流式响应空体**（根本原因修复）：之前的 `reply.raw.writeHead/end` 解决了 Fastify 序列化问题，但 Anthropic SSE 格式对 OpenAI 客户端不可解析。v0.2.3 通过实时协议转换彻底解决。
- **Tray start/stop 状态滞后**：click handler 改为即时调用 `buildTrayMenu()` 刷新菜单

## [v0.2.0] - 2026-07-15

### ⚠ Breaking

- **架构重写：Python → Node.js**。Server 改用 Fastify + better-sqlite3；CLI 改用 Node.js（Go 版移除）；Desktop 内嵌 fork Node.js server（不再 spawn Python uvicorn）。
- **默认端口 7300 → 38271**。监听 host `0.0.0.0`。
- **存储格式变更**：`server/data/nantianmen.db` + `requirements.txt` 全部移除。新增 `nantianmen-conf.json` 存于 exe 同目录，内含 `server_host`、`server_port`、`password`、`salt`、`database` 字段。
- **首次启动自动 init**：conf 不存在时 server 自动创建默认 conf（`password = md5(md5('admin') + salt)`）。不再要求先跑 `setup`。
- **Provider 名称仍不允许空格 / 下划线**（沿用 v0.1 规则）。

### Added

- `nantianmen-conf.json`：单文件配置 + 内存常驻，setup 写、CRUD 不写。
- 管理鉴权：`Bearer M = md5(RAWPASSWORD)`，server 校验 `md5(M + conf.salt)`。
- 密码修改：salt 重生成，旧密码立即失效。
- DB 抽象层 + SQLite3 (better-sqlite3, WAL) + MySQL 占位。
- 内存模型 map (`services/modelMap.js`)：`{name}_{protocol}_{model}` O(1) 解析。
- 流式代理：Node fetch + SSE pass-through。
- Token 统计：内存缓冲 + 10s 批量 INSERT。
- Desktop: Electron + Vue3 + Vite + Tailwind + frameless titlebar + tray + splash screen。
- CLI: `nantianmen` 子命令系统（setup/health/login/database/settings/password/provider/apikey/stats/restart/shutdown）。
- conf+db 跨端统一写入 user-data 子目录 `cj-nantianmen/`。
- `-c/-D` server CLI flags 支持自定义路径。

### Fixed

- SSE 流式响应空体：`reply.raw.writeHead/write/end` 替代 Fastify JSON 序列化。
- 默认模型路由 bug：`resolveModel()` 改用 `getDefaultEntry()`。
- 流式 usage:null 静默丢统计。
- 模型列表设默认后消失：`load()` / `fetchModels()` 调用顺序修正。
- Provider 编辑 API key 覆写：`??` → `||`。

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
