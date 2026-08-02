# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/),
本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [v0.4.23] — 2026-08-03

### Fixed
- **streaming + tool_call 参数吞没**：v0.4 Go server 的 `parseTokens` 函数在 SSE chunk 含未闭合 `{...` JSON 时会越界 panic，触发 chi.Recoverer 关闭 HTTP 连接，导致 tool_calls delta / finish_reason / `[DONE]` 全部丢失。表现：客户端 streaming 调用 tool_choice=required 时，tool_calls.arguments 永远是空字符串。修复方法：line 304-317 括号匹配循环后增加越界检查 `if depth != 0 || end >= len(text) { return }`（1 行）。已用 MiniMax-M3 + Deepseek-V4-Pro 验证 100% 修复。

## [v0.4.21] — 2026-08-02

### Changed — Go 重写 server/CLI（双轨 3-6 个月）
- **server/（全新 Go 实现）**：服务端用 Go 1.26.3 + chi/v5 + modernc.org/sqlite（pure Go，无 cgo）重写，cross-compile 友好；HTTP router 沿用 Node server 既有 `/v1/*`、`/api/admin/*` 端点，DB schema 100% 兼容 v0.3.15
- **CLI 切到 Go binary**：`server/cmd/nantianmen/` 提供 Go 版 CLI（`ClientVersion = 0.4.21`），握手校验 server 版本一致，不一致即退出码 1
- **Desktop spawn Go server**：`desktop/electron/main.cjs` 改用 `child_process.spawn` 启动 `extraResources` 里的 `server/nantianmen-server.exe`，env `NANTIANMEN_LOCAL_MODE=1` 跳过 admin auth；`before-quit` 钩子 SIGTERM 杀 Go 子进程
- **三端版本统一**：desktop `0.4.21` / Go server `ServerVersion = 0.4.21` / Go CLI `ClientVersion = 0.4.21` / `cli/package.json` `0.4.21`；Node server（`server/`）维持 `0.3.15` 双轨运行
- **PE 图标嵌入**：两枚 Go 二进制用 `rsrc -ico nantianmen.ico -arch amd64 -o icon.syso` 自动 link，Windows 资源管理器显示专属图标

### Why Go
- **部署简化**：single static binary，cross-compile 一行命令产出 Linux/macOS/Windows 三平台，无需在用户机器装 Node/Node-gyp/better-sqlite3 编译工具链
- **内存占用低**：~30-50 MB 峰值（Node 14/16 通常 80-150 MB 同等流量）
- **启动更快**：~150 ms vs Node ~1-2 s（冷启动 Desktop 立即见 Server online）
- **无 cgo 跨平台**：modernc.org/sqlite 是 pure-Go SQLite，Windows MSI/DMG 安装包不再依赖 MSVC redistributable
- **CLI 跨平台分发**：之前 Node CLI 需 `bun --compile` 才能产出单文件 EXE；Go CLI 直接 `GOOS=windows go build` 即产物

### Added
- **`POST /v1/embeddings` 端到端实测**：LMStudio `text-embedding-nomic-embed-text-v1.5@f16`（model.id=859），768 维向量，2 input；DB 写入 `usage_stats`（`request_count=1`，`input_tokens/output_tokens/cached_tokens` 全部 0）+ `communication_log`（`input` 存原文，`output` 存 `{embedding_dim, embedding_count, model, usage}` meta）
- **CLI `stats --capability=chat|embedding|all`**：Go CLI 数据统计按模型 capability 过滤（默认全部），配合 Desktop 顶部 select 用法一致
- **Desktop Stats 顶部 select「模型类型」**：「全部 / chat / embedding」，默认值「全部」，持久化到现有 `getUiFilters` 存储（与其他 select 同一套 `saveUiFilters` 接口）

### Fixed
- **`-D <db_path>` flag 真正覆盖 conf**：`server` 启动时从 conf 读 `Database.Path`，现在 `-D` flag 在 LoadConf 之后 re-apply `c.Database.Path = *dbPath`，默认 DB 路径 `C:/Users/ASUS/.cj-nantianmen/nantianmen.db`
- **`NANTIANMEN_LOCAL_MODE=1` env 让 Go server 跳过 admin auth**：`var localMode bool` + `func init()` 从 env 读，匹配 Node server `server/auth.js` 行为；Desktop spawn 不再需要发 Bearer token
- **SSE 流式响应缺 `\\n\\n` 分隔符**：`bufio.Scanner` 按 `\\n\\n` 切块并去分隔符，Go proxy 转发时主动补 `\\n\\n`，客户端 OpenAI SDK 能正常解析事件
- **SSE 流不发 `data: [DONE]`**：原代码只在 anthropic→openai 转时补 `[DONE]`；openai→openai 路径（如 MiniMax-M3）现无条件发 `data: [DONE]\\n\\n`，避免客户端 `Provider returned an empty stream with no finish_reason` 报错
- **`communication_log` INSERT NOT NULL 失败**：`logEntry` 稀疏 map 缺 `user_id / time / request_id` 字段，Go prepared stmt 不认 schema `DEFAULT ''`；`FlushBuffer` 入口给所有 nil 字段补零值，`map` 字段 marshal 成 JSON string 给 TEXT 列；chat + embedding 双路径同时修好
- **PE 图标嵌入**：Go 二进制无 Windows 资源表，现在含 RT_ICON(14) + RT_GROUP_ICON(12)
- **SSE scanner buffer 64KB→8MB**：DeepSeek thinking 块超 `bufio.Scanner` 默认 64KB 上限导致截断，`scanner.Buffer(make([]byte, 0, 1024*1024), 8*1024*1024)` 扩至 8MB（每次请求独立分配，响应结束 GC 回收）

### Migration
- **新装用户**：下载 `releases/nantianmen-0.4.21-win-x64.exe`（桌面）/ `nantianmen-server-0.4.21-win-x64.exe`（独立 server）/ `nantianmen-cli-0.4.21-win-x64.exe`（CLI），DB 路径沿用 v0.3.15 已有的 `C:/Users/ASUS/.cj-nantianmen/nantianmen.db`，无需数据迁移
- **v0.3.15 老用户**：可继续用 v0.3.15 EXE（`releases/nantianmen-0.3.15-win-x64.exe`），DB 共享；双轨运行 3-6 个月观察稳定性，期间不强制迁移；CLI 切到 Go 版即可享受 `--capability` 过滤

## [v0.3.15] — 2026-07-29

### Added
- **`POST /v1/embeddings` 代理** — OpenAI 格式 Embeddings 透传，仅 OpenAI 协议 provider；`assigned_model_id` 不适用，`body.model` 必须显式（不接受 `auto` / `Nantianmen-default`），Anthropic 协议返回 `400 embedding only supports openai protocol`；鉴权复用 `authApiKey` + `checkModelAuthorized`；计费仅 `prompt_tokens`，`output_tokens` / `cached_tokens` 一律记 0；`communication_log.output` 仅存元数据 `{model, dim, count, format, tokens}`，向量本体不落库，避免 1024 维 × N 次调用撑爆 SQLite
- **模型 `capability` 字段** — `models.capability TEXT NOT NULL DEFAULT 'chat' CHECK(capability IN ('chat','embedding'))`（SQLite ALTER TABLE 不支持 CHECK，老库 ALTER 落地时退化为无 CHECK，应用层 `proxyEmbeddingRequest` / `api.addModel` enforce）；新增 schema 列的 ALTER 幂等，旧库升级时 server 启动自动加列无需手动 SQL
- **Providers.vue UI 改造** — Add Model Modal 加 capability 单选 radio（chat 默认勾选）；模型列表在模型名后显示 chat/embedding tag（embedding 蓝底灰字 `bg-blue-500/20 text-blue-300`、chat 灰底暗字 `bg-gray-700 text-gray-400`）
- **CLI `provider model-add` 升级** — 交互提示 `Capability (chat|embedding) [chat]:`，接受 `embedding` 或 `e`，空输入默认 chat；`provider models` 列表输出新增 capability 列
- **i18n 三语加键** — `fld_capability` / `cap_chat` / `cap_embedding`，zh/en/ja 同步
- **docs/api.md + docs/api-en.md** — 新增 `/v1/embeddings` 完整段（鉴权、Provider 限制、计费、curl 示例、JSON 返回、错误码清单）
- **docs/cli.md + docs/cli-en.md** — `provider model-add` 命令描述补充 capability 交互说明

### Migration
- 旧库 `models` 表新增 `capability TEXT NOT NULL DEFAULT 'chat'` 列（ALTER TABLE 幂等），已有模型 capability 默认 'chat'，不影响 `/v1/chat/completions` 与 `/v1/messages` 现有调用路径
- **不需要手动 SQL**，server 启动自动检测并 ALTER

## [v0.2.14] — 2026-07-19

### Added

- **API Key 模型授权系统**：admin 可为每个 key 指定授权模型列表，`/v1/chat/completions` 和 `/v1/messages` 调未授权模型返回 `403 model not authorized`。
- **授权管理 UI**：ApiKeys 页面多选模型授权、授权数 badge（button 风格，始终显示含 0）、全选/取消全选、assigned_model 从已授权列表中单选。点击 badge 进入编辑弹窗。
- **可用模型过滤**：`GET /api/admin/api-keys/available-models` 不列出已停用/已删除模型（已存在授权不撤回）。
- **DB 自动清理**：启动时检测旧 schema（`deleted`/`assigned_model` 列），自动回填 `deleted_at`/`assigned_model_id` 后 DROP 废弃列。Desktop splash 窗口和 CLI 显示 `[ntm-cleanup] start/done` 进度。
- **CLI 授权交互**：`apikey new` 交互式多选授权模型；`apikey edit --auth=<id,...>` / `--assigned=<id>` flag 模式；`apikey ls` 显示授权数；`provider add` 创建前查重。

### Changed

- **model_id FK 化**：`usage_stats`/`communication_log`/`api_keys` 改走 FK 引用 models 表，model 改名后 JOIN 自动拿当前名（单点真理在 models 表）。
- **软删除**：`providers`/`models` 加 `deleted_at` 列替代旧 `deleted` INTEGER。废弃列在第一次启动时自动 DROP。
- **模型解析统一入口**：`resolveEntryFor()` 在 `modelMap.js` 中，`llmProxy.js` 和授权检查共用以防分叉。
- **i18n 清理**：删除 14 个未使用的 i18n key（zh/en/ja 三语同步，包括 `assign_model_hint`/`auth_count_label`/`tray_*` 等）。
- API 文档同步更新（`ApiDocs.vue` v0.2.14 端点描述和示例）。

### Fixed

- **用户管理 SQL 残留 `assigned_model` 列**：数据库迁移删除 `api_keys.assigned_model` 后，`routes/apikey.js` GET/POST/PUT 与 `services/llmProxy.js` 仍读取该废弃列，导致 `/api/admin/api-keys` 返回 500。改为 LEFT JOIN `models` 表读取 `model_name` 作为 `assigned_model` 别名；隔离端口回归脚本 `server/test_apikey_routes.js` 验证修复。
- **Server/Client 版本不一致静默运行**：`/v1/health` 新增 `version` 字段；Desktop `electron/serverCompatibility.cjs` 统一评估握手结果；版本不一致时 Desktop 主界面显示「Server 与 Desktop 版本不匹配」并拒绝加载业务页，托盘标记 `Version mismatch`；CLI 除 `help/quit` 外所有命令先握手，不匹配则退出码 1 并打印双方版本。LLM `/v1/*` 第三方调用不受 Client 版本限制。
- **build-mac workflow 产物文件名错位**：CI 不会同步 `desktop/package.json` 的 `version`，曾导致 tag 推送后产物文件名仍为旧版本号。workflow 新增「Sync version from tag」步骤，确保 `nantianmen-*-mac-*.dmg` 文件名与 tag 一致。

## [v0.2.13] — 2026-07-18

### Changed

- **版本 Bump**：v0.2.12 → v0.2.13。

## [v0.2.12] — 2026-07-18

### Fixed

- **流式路径 duration_ms 天文数字**：`makeStreamingResponse` 把 TTFB 毫秒数当时间戳拼入 `Date.now() - ttfbMs`，所有流式请求记录 ~17 万亿 ms 的 duration（[#50](https://github.com/Jiangcat8301/cj-nantianmen/issues/50)）。
- **t0 定位修正**：TTFB 计时起点从函数入口移到 `fetch()` 前一行，排除 DB 查询/协议转换开销。

### Changed

- 日志页 duration 红色阈值从 1s → 5s。
- **统一数据目录**：`~/.cj-nantianmen/` — server/cli/desktop 跨平台统一数据路径。
- 移除 `communication_log.json` 旧版 migration 代码（`commlog.js` -40 行）。

## [v0.2.11] — 2026-07-18

### Added

- **iconfont UI 图标系统**：全局替换 emoji 为自定义 iconfont（24 个图标），包括导航栏、dashboard 复制按钮、provider 操作按钮、api-key 显隐/分配、日志查看/复制。字体文件打入 CSS bundle。
- **API 文档示例卡片**：每个接口新增示例卡片 + icon-copy 按钮，一键复制 curl 命令。
- **用户管理「指定模型」弹窗**：app-key 行操作栏新增 icon-assign 按钮，弹出模型选择 modal（居中 + 650px 宽），选中后持久化到 `api_keys.assigned_model`。后端 `getAssignedEntry()` 优先路由分配模型。
- **代理设置**：系统设置新增代理配置，三种模式（system/direct/custom），存入 `nantianmen-conf.json`。`direct` 绕过系统代理直接连接，`custom` 提供 http(s)/socks5 URL。基于 undici ProxyAgent，lazy import 保证 Electron fork server 兼容。
- **日志耗时列**：TTFB（南天门发 request → LLM 回应首字节），`communication_log.duration_ms` 字段。桌面端 Logs.vue 表格右对齐显示，>1s 红色白色。CLI `log ls` 同步输出 `dur` 列。
- **加载动画**：日志管理页加载/翻页时显示毛玻璃旋转 spinner（`backdrop-blur + animate-spin`），三语 i18n（加载中…/Loading…/読み込み中…）。
- **CLI proxy 子命令**：`nantianmen proxy` 查看当前模式；`nantianmen proxy set <system|direct|custom> [url]` 切换。与 desktop 对齐。
- **CLI header 行**：`nantianmen log ls` 输出带表头（time/user/provider/model/in/out/cached/duration/status）。
- **多分辨率 .ico**：`nantianmen.ico` 包含 16/24/32/48/64/128/256 七个尺寸（PNG-in-ICO，Vista+ 格式），241 KB。打包进 EXE 资源。
- **macOS CI** (`.github/workflows/build-mac.yml`)：push tag `v*.*.*` 自动编译 x64 + arm64 DMG，产物上传 release。

### Changed

- **titlebar 升级**：高度 40px，logo 20×20 px。
- **全局 nowrap**：button、td、th 全用 `white-space: nowrap` 防止换行。
- **Stats top 卡**：高度 400→350px。
- **iconfont 引入方式**：从 `@import`（postcss 警告）改为 `main.js` 直接 `import './iconfont.css'`，0 warning。
- **耗时计算方式**：改为 fetch 返回 response headers 时刻（TTFB），非原来的全部 round-trip 时间。

### Fixed

- **PUT /api-keys/:id 500 Internal Server Error**：SELECT 语句中 `datetime(…,"localtime")` 双引号改为单引号，SQLite 之前报 `no such column: "localtime"`。
- **server 无法启动**（Electron fork 环境）：`proxyDispatcher.js` 改为 lazy `import('undici')`，找不到包时 silent fallback（undefined dispatcher = fetch 默认行为），不阻 server 启动。
- **任务栏图标缺失**：`BrowserWindow.icon` 从 PNG 改为多分辨率 .ico 文件，Windows 任务栏正常显示。
- **系统托盘图标**：改为 `nantianmen.ico` 多分辨率格式，Windows 自动选取最佳尺寸。

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
