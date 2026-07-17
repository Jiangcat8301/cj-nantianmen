# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [v0.2.9] — 2026-07-17

### Added

- **模型停用开关**：模型管理页每行右侧新增启用/停用 toggle switch。停用的模型不会出现在 `/v1/models` 列表，无法通过网关调用。重新启用后手动设为默认即可恢复使用。
- **数据统计 Top 3 并排显示**：原 Top 5 改为 Top 3，左（模型请求量）右（请求用户）各占 50% 宽度，卡片等高等宽，取消滚动，高度固定 400px 恰好容纳 3 条记录。

### Changed

- **日志管理** (#6)：默认保留条数 1000→500；右上角第二个按钮文字改为「现有日志 n/max」；修改保留条数时若小于当前已有条数，即时清理旧记录；列表按 ID 倒序排列。
- **系统概览页底部统计卡** (#2)：由固定 `grid-cols-5` 改为 `flex + flex-1` 等分布局，6 张卡片（含数据库体积）同一行不换行；窗口 <1000px 时降级为 4 列。
- **数据统计页布局** (#5)：Top 5→Top 3；标题从 bars 左侧移到上方；数据标签从 bars 内部移到 bar 右侧同行；行间距 `space-y-3→5`。
- **i18n 修正**：中文版「全部 Provider」→「全部供应商」。
- **Token 格式化统一**：`formatToken(n)` 提取到 `desktop/src/lib/format.js`，Stats/ApiKeys/Dashboard 三视图共用，支持 K→M 进位（>1024k 显示 M，1~2 位小数）。

### Fixed

- **数据统计 Top 5 重复** (#4)：同 provider+model 多 API key 时聚合拆出多行 → 后端 `stats.query()` 返回 `topModels`/`topProviders` 预聚合数组，前端直接消费。
- **用户管理页 Token 进位缺失** (#3)：`ApiKeys.vue` 本地 `fmt()` 只做 K（无 M），1,500,000→"1500.0K" → 现统一使用 `formatToken` 正确显示 "1.50M"。

## [v0.2.6] — 2026-07-16

### Fixed

- **非流式响应协议转换缺失**：流式路径有 `anthropicSSEToOpenAI()` 做响应转换，非流式路径直接 `return data` 原样返回上游格式。MiniMax-CodingPlan 返回 Anthropic 格式 (`content: [{text,...}]`) 而非 OpenAI 格式 (`choices: [...]`) → 客户端（Hindsight）收不到 `choices` 报错。新增 `anthropicRespToOpenAI()` / `openaiRespToAnthropic()` 双向非流式响应转换。
- **通信日志 Token 统计全零**：`extractTokensOpenai`/`extractTokensAnthropic` 返回 `{input_tokens, ...}` (snake_case)，`logEntry` 解构 `{inputTokens, ...}` (camelCase) → `...captured` 展开后 key 不匹配 → 全 `undefined` → `|| 0` → 全零。`logEntry` 改为双收 snake/camel + 归一化：`inputTokens = inputTokens ?? input_tokens ?? 0`。统计 DB 不受影响（`stats.record` 用 `r.input_tokens` 与 extract 返回值一致）。

## [v0.2.5] — 2026-07-16

### Fixed

- **统计时区彻底修复**：`u.created_at >= date('now','localtime')` → `datetime(u.created_at,'localtime') >= date('now','localtime')`。此前只转了比较参照侧，DB 存的 UTC 时间未转本地 → 北京时间 00:00-08:00 记录因 UTC 日期仍为前一天而漏统计。同时覆盖 today/7d/30d 三档。
- **API Key 时间显示**：`created_at` 和 `last_used_at` 查询时加 `datetime(col,'localtime')` 转换，前端直显本地时间。
- **托盘图标消失**：`main.cjs` 引用的 `tray-online/offline/active.png` 三个文件不存在 → 改用已有的 `nantianmen.ico`。

### Added

- **UI 过滤条件持久化**：数据统计和日志管理的 provider/model/range 等 filter 存入 `nantianmen-conf.json` 的 `ui_filters` 字段，页面切换不丢状态。

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
