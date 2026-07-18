# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [v0.2.8] — 2026-07-16

### Added

- **Minimax `<function_calls>` XML v3 tool_call parser**（commit `b6e4ba5`）：Minimax 协议下识别 `<function_calls>` XML 格式的 tool_calls，转为 OpenAI 标准格式。Minimax 5 种 tool_call 格式之一。

### Fixed

- **`openaiReqToAnthropic` non-string content 修复**（commit `7dd6c22`）：当 Anthropic 协议下游收到的 message content 不是 string（如 array of blocks）时，OpenAI→Anthropic 转换时 stringify 处理，避免下游 API 报错。

## [v0.2.7] — 2026-07-15

### Added

- **commlog 落库迁移**：原 `communication.log` JSON 文件改为 SQLite `communication_log` 表，支持索引 + 查询 + 翻页（`?lines=`）。
- **tool_use 格式转换**：OpenAI `tool_calls` ↔ Anthropic `tool_use` 双向桥接。
- **SSE 协议转换**：OpenAI `data: {...}` ↔ Anthropic `event: ...` 流式协议桥接。
- **Graceful shutdown flush**：server 关闭前 flush 内存中的 usage/commlog 批次到 SQLite。

### Fixed

- **cached token 重复计费**：原 cost 公式 `input × input_price + cached × cache` 把 cached tokens 算了两遍。改为 `(input - cached) × input_price + cached × cache`。

## [v0.2.10] — 2026-07-17

### Added

- **模型管理「全部启用 / 全部禁用」开关**：每个供应商展开模型列表时，新增一个聚合 toggle，反映当前供应商模型启用状态聚合——所有启用时显示「全部禁用」（点击批量停用），存在停用时显示「全部启用」（点击批量启用）。无新增 server 端点，复用 `Promise.all` 并发 `PUT .../toggle`。
- **数据统计默认模型说明卡**：模型管理页顶部"所有 provider 中首个设为 ★ 默认的模型..."的散文字段替换为圆角矩形卡，包含「默认模型：Nantianmen-default」+ heroicons clipboard 复制图标（点击复制模型名）+ 一句话说明。
- **CLI `provider model-toggle <pid> <mid>`**：CLI 入口支持 v0.2.9 引入的 model disable 功能（之前只能通过 desktop 切换）。
- **CLI `default-model` / `default_model`**：查询当前默认模型。
- **CLI `database info` / `database move`**：查询数据库类型/路径/大小/log_count；将 DB 文件迁到新路径（server 端操作）。
- **CLI `stats` 输出补全 `topModels` / `topProviders` 字段**：与 desktop 共用 server 端聚合结果。
- **Mac 桌面端 CI** (`.github/workflows/build-mac.yml`)：`macos-latest` runner 编译 `.dmg` + `.zip` × `x64` + `arm64`。push tag `vX.Y.Z` 自动触发；产物以 artifact 上传（保留 14 天）。本地 Windows 编译 macOS 官方不支持，本方案规避。**ad-hoc 签名（无 Apple Developer 证书），用户首次打开 .app 需右键 → 打开**。

### Changed

- **左侧导航顺序**：API 文档挪到日志管理下边（顺序：仪表盘 → 模型管理 → 用户管理 → 数据统计 → 日志管理 → **API 文档** → 系统设置）。
- **数据统计 breakdown 改为按供应商聚合**：原「按 (provider, model, api_key) 三元组明细」改为「按 provider 聚合一行 + 点击展开该供应商每个 model 明细」。Per-api_key 明细不再展示（保留在 `nantianmen apikey ls` + 用户管理页）。与桌面 Stats.vue `providerGroups` 同构，CLI `stats` 输出同步按 provider → model 双层聚合。
- **CLI `cmdStats` cost 公式统一**：原 inline 旧公式（`input × input_price + cached × cache`，cached 重复计费）替换为共享 `calcCost`（`(input-cached) × input_price + output × output_price + cached × cache`）。三视图（顶部总额卡、Top 3 模型 bar、Top 3 用户 bar、breakdown 表）cost 完全一致。
- **server `topProviders` cost 算法修复**：原 `byProvider` Map 累加 token 时，price 只在第一行定下，导致同一 provider 下不同价格的 model 全用第一行价格算总额（如 Deepseek 整个供应商用 v4-pro 价格 3/6/0.025 算，¥10.5509；真实聚合 ¥6.7949 = v4-pro ¥4.5381 + v4-flash ¥2.2568）。改为按 row 真实价格累加 cost，provider 行不再带 price 字段。`topModels` 同时加 cost 字段作为唯一事实来源。
- **README 自述段落**：开头加一段作者自述（中英两版）说明工具动机——「频繁修改各种智能体的配置文件切换模型是一件非常'不优雅'的事情」。

### Fixed

- **CLI 多处硬 bug**（历史 v0.2.7 commit 遗留）：
  - `cli/index.js` L56 regex 4 个反斜杠（应 2 个）——node 24 跑 CLI 必崩，仅 bun-compiled exe 容忍。
  - L476 `apikey: *** apikeys` —— `***` 字面量导致 `CMDS` 对象语法错误。
  - `call()` 函数 PUT/POST 无 body 但仍设 `Content-Type: application/json` —— server `Fastify` 报 `Body cannot be empty when content-type is set to 'application/json'`，影响所有无 body 命令。
  - `fn().catch()` 在 `help`/`quit` 命令上崩（handler 返回 undefined，无 `.catch`）。

## [v0.2.9] — 2026-07-17

### Added

- **模型停用开关**：模型管理页每行右侧新增启用/停用 toggle switch。停用的模型不会出现在 `/v1/models` 列表，无法通过网关调用。重新启用后手动设为默认即可恢复使用。
- **数据统计 Top 3 并排显示**：原 Top 5 改为 Top 3，左（模型请求量）右（请求用户）各占 50% 宽度，卡片等高等宽，取消滚动，高度固定 400px 恰好容纳 3 条记录。

### Changed

- **日志管理** ([#6](https://github.com/Jiangcat8301/cj-nantianmen/issues/6))：默认保留条数 1000→500；右上角第二个按钮文字改为「现有日志 n/max」；修改保留条数时若小于当前已有条数，即时清理旧记录；列表按 ID 倒序排列。
- **系统概览页底部统计卡** ([#2](https://github.com/Jiangcat8301/cj-nantianmen/issues/2))：由固定 `grid-cols-5` 改为 `flex + flex-1` 等分布局，6 张卡片（含数据库体积）同一行不换行；窗口 <1000px 时降级为 4 列。
- **数据统计页布局** ([#5](https://github.com/Jiangcat8301/cj-nantianmen/issues/5))：Top 5→Top 3；标题从 bars 左侧移到上方；数据标签从 bars 内部移到 bar 右侧同行；行间距 `space-y-3→5`。
- **i18n 修正**：中文版「全部 Provider」→「全部供应商」。
- **Token 格式化统一**：`formatToken(n)` 提取到 `desktop/src/lib/format.js`，Stats/ApiKeys/Dashboard 三视图共用，支持 K→M 进位（>1024k 显示 M，1~2 位小数）。

### Fixed

- **数据统计 Top 5 重复** ([#4](https://github.com/Jiangcat8301/cj-nantianmen/issues/4))：同 provider+model 多 API key 时聚合拆出多行 → 后端 `stats.query()` 返回 `topModels`/`topProviders` 预聚合数组，前端直接消费。
- **用户管理页 Token 进位缺失** ([#3](https://github.com/Jiangcat8301/cj-nantianmen/issues/3))：`ApiKeys.vue` 本地 `fmt()` 只做 K（无 M），1,500,000→"1500.0K" → 现统一使用 `formatToken` 正确显示 "1.50M"。

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
