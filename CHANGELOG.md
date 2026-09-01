# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/),
本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [v0.5.1] — 2026-08-20

### Changed — macOS 桌面只发布 arm64 版（v0.5.1 起）

- **从 v0.5.1 起，macOS 仅构建 arm64（Apple Silicon），不再构建 amd64 / x64（Intel Mac）**。
- `.github/workflows/build-mac.yml`：删除 `amd64` / `x64` GOARCH 行；mac job 去掉 `strategy.matrix.arch: [arm64, x64]`，固定 `--arm64`；release 上传只保留 arm64 文件。
- `desktop/package.json` 的 `mac.arch` 已是 `["arm64"]`，无需改动。
- macOS arm64 已覆盖近 5 年所有在售 Mac，Intel Mac 用户极少。后续若需要 x64 版本，重新加 `strategy.matrix.arch` 即可。
- CI 耗时减半（mac job 从 matrix 2 个 runner 降为 1 个），节省 GHA 分钟。

### Added — 默认 Embedding 模型（与默认 Chat 模型分离）

- 新增 `is_default_embedding` 列（schema + migration），与 `is_default`（默认 Chat）独立。同一 model 行可同时为 default chat + default embedding。
- 新增虚拟模型名 `Nantianmen-default-embedding`：`/v1/embeddings` body `model` 字段填此值即走默认 embedding 路由（类比 `Nantianmen-default` 走默认 chat）。
- 新增 API：
  - `GET /api/admin/default-embedding-model` — 查询当前默认 embedding 模型。
  - `PUT /api/admin/providers/{id}/models/{mid}/default-embedding` — 设置默认 embedding 模型（仅 `capability=embedding` 通过）。
- `PUT /default`（原设置默认模型）增加 `capability=chat` 校验：非 chat 模型返回 400。
- `toggle` disable 时联动清除 `is_default_embedding`（与 chat default 同逻辑）；`delete` 拒绝删除 default embedding 模型（400）。
- 首次创建 provider 时，自动选首个 chat 模型设 default chat + 首个 embedding 模型设 default embedding。
- `GET /providers`（嵌套 models）+ `available-models` 查询返回 `is_default_embedding` 字段。

### Changed — UI/CLI/i18n 文案适配双默认模型

- Dashboard「默认模型」→「默认Chat模型」，下方新增「默认Embedding模型」信息块（blue 配色）。
- Providers info card 改双行（chat emerald + embedding blue），各带 copy 按钮。
- 模型列表按钮条件渲染：chat 模型显示「设为默认Chat模型」/「★ 默认Chat」；embedding 模型显示「设为默认Embedding模型」/「★ 默认Embedding」。delete 按钮 `:disabled` 同时检查两个 default 标志。
- ApiKeys 列表 `★` 标记拆为 `★Chat`（emerald）/ `★Emb`（blue）。
- Tray 菜单「设置默认模型」拆为两个子菜单：chat（仅 chat 模型）+ embedding（仅 embedding 模型）。
- i18n（zh/en/ja）新增 8 key + 改 3 旧 key 语义（`default_provider_model`、`set_default`→`set_default_chat`、`default_badge`→`default_chat_badge`）。
- CLI 新增 `models setdefault <pid> <mid>` + `models setdefault-embedding <pid> <mid>` 子命令；`ls` 输出加 `★default-emb` 标记。

### Fixed — FRPC 自定义域名原样使用 + 日志窗

- **域名原样写入 customDomains**：之前 renderToml 会拿 frps 的 serverAddr 的 host 当根域名拼二级域名（`subdomain + "." + serverAddr-host`），这强制所有用户挂在 frps 域名下，且用户填完整域名（如 `nantianmen.ylpb360.com`）时会被双重 suffix。修复：`customDomains = [用户填的原样]`，不派生任何东西。frp 的 `customDomains` 是完整域名列表，与 serverAddr 无关——frps host 是 a.com、用户 vhost 是 b.net 完全合法。`startFrpc()` 校验改为要求 server_addr + server_port + 自定义域名（HTTP 模式没有 customDomains 无法路由）。i18n 文案 `frpc_field_subdomain` 改成「自定义域名（完整，如 b.net）」三语。
- **FRPC 日志滚动窗**：ReverseProxy 页底部新增 log 面板，显示 frpc stdout/stderr，最多保留 100 行（main 进程内存环形缓冲，滚动到底部自动跟随）。主进程把 stdio 从直接 pipe 到文件改成 pipe + 内存缓冲（`feedLogChunk` 按行切分），新增 IPC `frpc:log:get`；前端 `refreshLog()` 2s 轮询，按 `[E]/[W]/[I]` 着色。frpc 未运行时回退读 `frpc.log` 文件最后 100 行。三语 i18n 新增 `frpc_log_title` / `frpc_log_empty`。

### Fixed — FRPC HTTP routing by subdomain (was `remotePort`)

- frps HTTP 模式所有代理共用一个端口(典型 20080),按 `Host` 头路由 — `remotePort` 在 HTTP 模式下没用。之前的 `remote_port` 输入框 + toml `remotePort = ...` 写出去其实是空跑。
- 改用 `subdomain`:用户填一个唯一子串(例 `jiangcat`),toml 生成 `subdomainHost = "jiangcat.<serverAddr-base>"` + `customDomains = [...]`。其他 nantianmen 用户填不同子串就能在同一 frps 上共存。
- frpc 0.71.0 原生支持 `subdomainHost` / `customDomains`。
- UI:`remote_port` 字段改为 `subdomain`(文本输入,placeholder `jiangcat`),`remote_port` 字段保留兼容(但不再使用)。`startFrpc()` 校验从 `server_addr+server_port+remote_port` 改成 `server_addr+server_port`(subdomain 可选)。
- i18n:三语新增 `frpc_field_subdomain`(`子域名(必须唯一)` / `Subdomain (must be unique)` / `サブドメイン(必須ユニーク)`),`frpc_field_remote_port` 文案改成 `公网端口(HTTP模式无需填)` 系列。

### Fixed — FRPC proxy type: `tcp` → `http`

- 之前 `renderToml()` 写的是 `type = "tcp"`(裸 TCP 隧道)。TCP 模式 frps 那边只看到一条 client + 一个 raw TCP channel,**没办法 HTTP 路由到它**(没有 vhost / subdomain / path 匹配)。用户场景是从公网访问南天门的 OpenAI 兼容 `/v1/chat/completions` — 必须走 HTTP。
- 改为 `type = "http"`,加 `customDomains = ["nantianmen.local"]` + `locations = ["/"]`。frps 在 `remotePort` 上暴露真实 HTTP endpoint,reverse-proxy 到本机 `127.0.0.1:localPort`。
- frpc 0.71.0 原生支持 `type = "http"`(无需 plugin)。
- 访问方式:从公网 `http://frps-ip:remotePort/`(或绑 domain 后用 `http://domain:remotePort/`)→ frps → frpc 隧道 → 本机南天门 server。

## [v0.5.0] — 2026-08-20

### Fixed — TRay FRPC 启用/停用 UI + 配置未填时的错误处理

- **Tray FRPC 启用/停用改为 checkbox switch**：原 tray 菜单在 `enabled=true` 时同时显示"启用 FRPC"和"停用 FRPC"两个独立项，是 menu item 而不是 switch，用户期望是一个 toggle。修复：改成 Electron 原生 `type: 'checkbox'` 菜单项（label = "FRPC 公网穿透" / "FRP tunnel" / "FRP トンネル"），勾选状态镜像 `frpc.enabled`；点击切换走 `frpc.enable()/disable()`，disable 同时 kill 当前进程。`enabled=true` 时下方仍显示"启动/停止 FRPC"按钮（按运行状态切换文案）。三语 trayLabels 新增 `frpcEnableToggle`。
- **"FRPC config incomplete" 错误体验差**：用户刚装 / 没填过 FRPS 配置就点"启用"，直接报 500-style 字符串错误，用户不知道下一步该干嘛。修复：tray `frpc.start()` 在配置不全时改为返回 `{ ok:false, reason:'config-incomplete', message: ... }`，不再 throw；同步广播 `frpc:open-settings` IPC → App.vue 监听 `onOpenSettings` → `window.location.hash='#/reverse-proxy'` 把用户跳到设置页。Vue 端 `start()` 收到结果时把 `reason` 映射成 i18n 文案 `frpc_err_config_incomplete`（zh「请先在下方填写 FRPC 服务器配置」/ en「Please fill in the FRP server fields below first」/ ja「先に下方の FRP サーバー設定を入力してください」）。三语 trayLabels/i18n 各加 1 个 key。`no-binary` 也走同样的 typed-error 模式（不再 throw）。

### Fixed — 反向代理下载 UX 三个 bug

- **下载期间无法取消**：原"下载中"按钮只有一个下载按钮 disabled 状态，无法中止 13.9 MB 的下载。修复：下载期间切换为红色「取消下载」按钮，点击触发 `AbortController.abort()` → main 进程立刻 destroy HTTPS request + 删半截 tmp 文件 + 广播 `frpc:download:state { cancelled:true }`，UI 立刻回到「下载」按钮态。三语 i18n 新增 `frpc_btn_cancel`（zh「取消下载」/ en「Cancel download」/ ja「ダウンロードをキャンセル」）。
- **代理不生效**：原 `https.get(url)` 在 Windows 上不走系统代理，导致开了 1099 端口 SOCKS5 代理后 ETIMEDOUT 20.205.243.166。修复：
  1. Electron main 启动时 `reg query HKCU\...\Internet Settings /v ProxyEnable,ProxyServer` 拿到 `127.0.0.1:1099`。
  2. 用已经装好的 `https-proxy-agent` 包（Electron transitive dep，未新增 npm 依赖）构造 `HttpsProxyAgent`，替代 Node 不支持的 `HTTPS_PROXY` env var（Node <22 不解析此 env var 是已知行为）。
  3. 优先级链：nantianmen-conf.json `proxy=custom` → `proxy=direct` → 系统代理（IE 注册表）→ 直连。
  4. error 信息改为 `<code> <message>`（之前 ECONNRESET / ETIMEDOUT 只显示 "socket hang up"）。
- **路由切换打断下载进度显示**：从「反向代理」切到「数据统计」再切回去，UI 不再显示"下载中"。修复：Electron 主进程维护 module-scope `downloadState`（`{active, startedAt, version, ok, cancelled, error}`），下载状态变化时 `BrowserWindow.getAllWindows().forEach` 广播 `frpc:download:state` IPC；renderer 侧 `onMounted` 调 `downloadState()` 拉当前 state 恢复显示，并在 `ReverseProxy.vue` 模板显示"切到其他页面不影响下载"提示。三语 i18n 新增 `frpc_keep_alive_hint`。
- 新增 IPC channels：`frpc:cancelDownload`（取消）+ `frpc:downloadState`（查询）；preload 同步暴露。`module.exports` 加 `cancelDownload`。

### Changed — 文案统一

- 「FRPC 项目主页」→「FRP 项目主页」三语（zh/en/ja）。
- 「通过 FRPC 将本地端口映射到你的公网 FRPS」→「通过 FRP Client 将本地端口映射到你的公网 FRP Server」三语。frp 官方项目名是 "frp"，"frpc" 和 "frps" 是 client/server binary 的可执行文件名，不是项目名；之前文案把可执行文件名当成项目名了。

### Added — Titlebar 三 chip（FRPC / Server / 版本号）

- Desktop 自定义标题栏右侧改为 3 个独立 chip，中间用 `border-r border-gray-700/50` 细分隔线，从左到右依次：
  - **`FRPC` 状态**：4 态指示 — 未下载 / 已停用（灰）/ 已停止（琥珀）/ 运行中（绿）。
  - **`Server` 状态**：沿用旧配色 — 在线（绿）/ 离线（红）/ 版本不匹配（琥珀）。
  - **`版本 vX.Y.Z`**：mono 字体灰字，明确标明 desktop 客户端版本。
- 新增 `frpcStatus` ref + 3 个 computed（`frpcDotClass` / `frpcTextClass` / `frpcLabel`）+ `refreshFrpcStatus()`。3 秒轮询 + IPC `frpc:status` 实时 hook（ReverseProxy 页面切换状态时立即刷新）。
- 三语 i18n 新增 `frpc_titlebar_hint`（hover tooltip「点击侧栏「反向代理」管理 FRPC」）和 `version_label`（zh 「版本」/ en 「Version」/ ja 「バージョン」）。
- **仅 desktop UI 改动**：server 与 CLI 不感知，跨端无 ABI 影响。

### Build — v0.5.0 Windows artifacts**（SHA-256 锚点，便于以后 grep 比对）**
| 产物 | size | SHA-256 |
|---|---|---|
| `nantianmen-server-v0.5.0-win-x64.exe` | 11.66 MB | `299a8df633e7415cf5de6ee6c6670781e8684039268d7f4d491bb18090f3281b` |
| `nantianmen-0.5.0-win-x64.exe`（desktop portable，含 v0.5.0 server alias） | 79.08 MB | `ae7d1abbba636d848e310d62...` |
- Server binary 用 `go build -ldflags="-s -w"` 去符号，比 v0.4.24（16.92 MB）瘦 5 MB。
- Desktop 体积从 v0.4.24 (83.56 MB) 降到 **79.08 MB**（瘦了 4.5 MB，因为内嵌的 server 从 16.93 MB 瘦到 11.66 MB）。asar 内部新增 `electron/frpc.cjs` + `src/views/ReverseProxy.vue`，由 vite tree-shake 消化，无新增 node_modules 依赖。
- asar verify 通过：FRPC IPC handler、`providersCache` 5s TTL、tray 标签三语字面量、Vue i18n key 全部已落盘。

### Added — 托盘菜单 FRPC 启停 + 一键切换默认模型

- **托盘菜单启用/停用 FRPC**：仅当检测到 `~/.cj-nantianmen/frpc/frpc.exe` 已下载时显示。启用状态分两态：`enabled=true` 显示「启动 FRPC / 停止 FRPC」+「停用 FRPC」(停用会 stop 进程并落 `enabled=false`)；`enabled=false` 显示「启用 FRPC」(只落 `enabled=true`，不自动起进程)。复用 `frpc.cjs` 现有 module exports，不新增 IPC handler。
- **托盘菜单「设置默认模型」**：两层 submenu，第一层是 provider 名（按字母序），第二层是该 provider 下所有 `is_disabled=0` 的模型（跳过已禁用）。当前默认模型后跟 `✓ 当前默认` 标记（zh/en/ja 三语）。有价格字段（input/output_price）的模型在菜单行末尾追加 `💰 输入 $X/M  输出 $Y/M`。无价格字段时优雅隐藏价格行（providers 接口 schema 不返回价格，需要价格时改用 `GET /api/admin/models`）。
- **后端复用 0 改动**：完全利用现有 `GET /api/admin/providers`（嵌套 models，含 `is_default`/`is_disabled`）和 `PUT /api/admin/providers/{id}/models/{modelId}/default`（server 自动清零其他 is_default 再设新 default，不需 auth，server 已在 chi 路由里无 middleware）。providers 列表 5s TTL 缓存 + 点击切换后立即 invalidate。
- **trayLabels 三语扩展**：zh/en/ja 各加 6 个 key (`frpcEnable/frpcDisable/frpcStart/frpcStop/setDefaultModel/defaultModelCurrent/defaultModelNone/defaultModelErr` + `priceFmt` 函数)，沿用现有 dict inline 模式，无新依赖。

### Added — FRPC 启用/停用切换（独立于"随南天门启动"）

- 新增 **`frpc.enabled`** 配置字段：用户主动"启用/停用 FRPC"的总开关。停用 = 关进程 + 持久化 `enabled=false`；启用 = 持久化 `enabled=true`，进程状态由用户后续手动启动。配置中其他字段（server_addr / token / 端口等）原样保留。
- **`enabled` 与 `auto_start` 解耦**：启用/停用只动 `enabled`，**不会**改变 `auto_start`。`auto_start=true + enabled=false` = 配好了但不希望跑；`auto_start=false + enabled=true` = 不自动跑但可手动启。
- **Desktop**：反向代理页面新增「启用 / 停用」主按钮（替代旧的「启动 / 停止」位置）+ 三态状态指示（已停用灰 / 已停止琥珀 / 运行中绿）。启动 / 停止按钮仅在 `enabled=true` 时显示。停用点击会先 `frpc.stop()` 再落盘。三语 i18n 新增 `frpc_btn_enable` / `frpc_btn_disable` / `frpc_status_disabled`。
- **CLI**：新增 `reverse-proxy enable` 和 `reverse-proxy disable` 子命令。`disable` 先 stop 再落 `enabled=false`；`enable` 只落 `enabled=true`。`status` 输出新增 `enabled` 字段。`config` 支持 `enabled=true|false`。help 文本更新。
- **boot 行为变更**：desktop 启动时 `autoStartIfEnabled()` 增加 `if (!c.enabled) return` 早返回；legacy conf（无 `enabled` 字段）默认 `enabled=true` 兼容旧行为。

### Added — 公网穿透 / FRPC 反向代理

- **Desktop 新增「反向代理」侧栏页面**（路径 `/reverse-proxy`）。顶部说明 + FRPC GitHub 链接 + 大号「下载最新版 FRPC」按钮 + 进度条。下载完成后展开 6 字段配置表单（FRPS 地址/端口/Token、远程端口、本地端口）+ 「随南天门启动」开关 + 启动/停止按钮 + 状态指示（运行中 pid / 已停止）+ 二进制路径显示。三语 i18n（zh/en/ja）新增 17 个 keys。
- **FRPC 二进制管理**：首次访问页面点「下载」从 GitHub releases `v0.71.0` 拉取当前平台对应 zip/tar.gz（macOS arm64/x64、Win amd64/arm64、Linux amd64/arm64），通过系统 `tar`（Win10 1803+ 自带 `tar.exe`）就地解压到 `userData/frpc/frpc[.exe]`。下载进度通过 IPC `frpc:download:progress` 节流（每 200ms 一次）推到渲染层。
- **进程生命周期**：Electron 主进程 `electron/frpc.cjs` 负责 spawn/kill。`before-quit` 钩子确保 desktop 退出时优雅 stop（`taskkill /T /F` 杀整树）。`auto_start` 配置时 desktop boot 后自动 spawn，失败仅 `console.warn`，不阻断 desktop 启动。
- **配置持久化**：`server/internal/conf/conf.go` 新增 `Frpc *FrpcConfig` 字段；desktop 通过 `frpc:conf:get|set` IPC 直接读写同一份 `~/.cj-nantianmen/nantianmen-conf.json`，无 API 调用，进程间自动同步。
- **CLI 新增 `reverse-proxy` 子命令**（`download | start | stop | status | config`）。`config` 支持 `key=value` 多对（`server_addr`、`server_port`、`token`、`remote_port`、`local_port`、`auto_start`）；`status` 自动 redact token（`ab****23`）；配置存 CLI 自己的 `~/.cj-nantianmen/config.json`（与 server conf 解耦，无 server 也能用）。Help 文本加 `reverse-proxy`。
- **架构隔离**：FRPC 完全独立子进程，零代码侵入 server（仅多一个 `FrpcConfig` JSON 字段）和 proxy 路径（LLM 调用不走 frp 隧道）。FRPC 挂掉不影响本地 127.0.0.1:38271 访问。
- **⚠️ 注意**：部分杀软（Defender SmartScreen / 360 / AVG 等）会把 frpc.exe 标记为潜在威胁并自动 quarantine（frp README 已知问题 [issue #3637](https://github.com/fatedier/frp/issues/3637)）。下载后如发现 binary 消失，请把 `%APPDATA%\cj-nantianmen\frpc\frpc.exe` 加入杀软白名单后重新点击「下载最新版 FRPC」。

### Security

- FRPC 进程通过 token 鉴权接入 FRPS，token 在 `status`/`config` 输出中自动 redact（`ab****cd` 形式）。生产部署强烈建议 FRPS 配置 `tls.force = true` + `allowPorts` 白名单。

## [v0.4.24] — 2026-08-11

### Added — 模型删除（Desktop + CLI）
- **Desktop 模型行删除按钮**：Providers.vue 每个模型行右侧新增红色删除按钮。默认模型按钮 disabled（半透明 + tooltip "默认模型不可删除"）；其他模型点击后弹确认对话框（"该模型会从所有 API Key 的授权列表中移除。如果某 API Key 被分配过该模型，将自动恢复使用 Nantianmen-default"），确认后调 `DELETE /api/admin/providers/{id}/models/{modelId}`。三语 i18n (`delete_default_forbidden`) 同步。
- **Server 删除路由**：新增 `DELETE /api/admin/providers/{id}/models/{modelId}`，默认模型返回 400 `cannot delete default model`，硬删后调 `modelmap.RebuildModelMap()` 让 `/v1/models` 立刻反映。Schema cascade 行为自动生效：`api_key_models.model_id ON DELETE CASCADE` 移除该模型从所有 API Key 的授权列表；`api_keys.assigned_model_id ON DELETE SET NULL` 把被分配过该模型的 Key 的 override 清空，proxy 自动 fallback 到 Nantianmen-default；`usage_stats` / `communication_log` 历史行保留，`model_id` SET NULL 不影响 cost/usage 历史。
- **CLI `models` 子命令**：新增 `models ls <provider-id>`（列出模型 + 能力 + ★default/disabled 徽章）和 `models rm <provider-id> <model-id>`（y/N 二次确认）。`providers ls` 输出末尾追加嵌套 model 数（`3 models`），方便 CLI 操作员决定要不要 drill down。Help 文本同步加 `models`。
- **CLI 子命令 args 切片 bug fix**：`main()` 之前用 `os.Args[2:]` 给子命令 handler，flag value（如 `--port 40999`）也会被算进 sub args，导致 `providers ls`、`apikey ls` 等子命令接 `sub="40999"` 静默返回（exit 0、没输出）。改用 `subIdx` 记录 sub 在 os.Args 的位置，传 `os.Args[subIdx+1:]`，所有子命令统一受益。

### Added — Cost 落库 + UI 花费列
- **价格三件套 + cost 列**：`models` 加 `input_price` / `output_price` / `cache_hit_price`（REAL NOT NULL DEFAULT 0）；`usage_stats` 和 `communication_log` 各加 `cost REAL NOT NULL DEFAULT 0`。`RebuildModelMap` 启动回填 price，`modelmap.Entry` 暴露三件套。
- **proxy 结束算 cost 并落库**：`proxy.go` 新增 `computeCost(entry, in, out, cached)`，按 `(uncached_input × input_price + output × output_price + cached × cache_hit_price) / 1M` 在请求结束时算 cost，代入 `stats.Record(...)` / `logEntry` 写入 `usage_stats.cost` 和 `communication_log.cost`。改价不会回溯污染历史。
- **Desktop 日志管理「花费」列**：Logs.vue 在「命中%」之后新增「花费」列，`fmtCost` 格式：`0/null → −`、`<0.0001 → >¥0.0001`、`≥0.0001 → ¥0.XXXX`（4 位小数，¥ 符号）。三语 i18n (`log_cost`) 同步。
- **CLI `stats` breakdown 加 cost 列**：stats 子命令的 total 行加 `cost: $X.XX`，breakdown 表新增 `cost` 列（7 列：provider / model / reqs / in / out / cached / cost），用 `toF()` 工具函数把 JSON number 转 float64。

### Fixed
- **FlushBuffer trim 误触发删 communication_log**：`commlog.go` 的 `FlushBuffer` 末尾在 `LogRotationEnabled=true && LogRotationMax=0` 时跑 `TrimToMax(500)`，**每次 flush 都执行**（10s tick），server 重启后高频写入导致最早行被批量 trim → WisUnite (pid=9) 7 行 + 其他老行集体失踪。修复：FlushBuffer 不再 trim，移到独立 `initRotation()` ticker（60s 一次），gate 改成 `LogRotationEnabled && LogRotationMax > 0`。
- **`runMigrations` 死代码**：历史遗留 `UPDATE models SET deleted_at=datetime('now') WHERE deleted=1` 引用 schema 不存在的 `deleted` 列，Exec 静默吞错。删除该行，schema 用 `deleted_at` 替代。
- **Desktop `log_cost` i18n 缺失**：缺 zh/en/ja 三语键值，中文版显示「花费」，与 `t('log_cost')` 兜底文案对齐。

### Migration
- **现有用户**：`runMigrations` 启动时自动加 `cost` 列；新装 EXE 直接生效。
- **已生产运行的 v0.4.23 db**：手动 `ALTER TABLE` + `UPDATE` 单事务回填历史 cost（基于 `model_id = models.id` JOIN 价格），无需停 server：
  ```sql
  ALTER TABLE usage_stats ADD COLUMN cost REAL NOT NULL DEFAULT 0;
  ALTER TABLE communication_log ADD COLUMN cost REAL NOT NULL DEFAULT 0;
  UPDATE usage_stats SET cost = ROUND(
    (input_tokens - cached_tokens) * m.input_price / 1000000.0
    + output_tokens * m.output_price / 1000000.0
    + cached_tokens * m.cache_hit_price / 1000000.0, 6)
  FROM models m WHERE usage_stats.model_id = m.id
    AND (m.input_price > 0 OR m.output_price > 0 OR m.cache_hit_price > 0);
  -- 同理 communication_log。无价 model 留 cost=0。
  ```
- **WisUnite 历史数据恢复**：v0.4.23 trim bug 把 backup 之前 33 分钟的 256 行 communication_log（包括 WisUnite 7 行）误删。0.4.24 部署后用 `ATTACH DATABASE '<backup>.db' AS bkp` + 显式列名 INSERT 恢复 274 行（cost 默认 0），再跑回填 SQL 补全 cost。无 backup 覆盖的行无法恢复（WAL tombstone）。

## [v0.4.23] — 2026-08-03

### Fixed
- **streaming + tool_call 参数吞没**：v0.4 Go server 的 `parseTokens` 函数在 SSE chunk 含未闭合 `{...` JSON 时会越界 panic，触发 chi.Recoverer 关闭 HTTP 连接，导致 tool_calls delta / finish_reason / `[DONE]` 全部丢失。表现：客户端 streaming 调用 tool_choice=required 时，tool_calls.arguments 永远是空字符串。修复方法：line 304-317 括号匹配循环后增加越界检查 `if depth != 0 || end >= len(text) { return }`（1 行）。已用 MiniMax-M3 + Deepseek-V4-Pro 验证 100% 修复。
- **user_id 格式化为 "3.0" 字符串**：`proxy.go:logEntry` 将 api_key ID 用 `fmt.Sprintf("%d.0", id)` 格式化为 "3.0" 写入 communication_log.user_id（TEXT 列），导致日志管理和数据统计中用户显示为 "3.0" / "Key #3"。修复：`user_id` 存储为 int64，`user_id` 列类型从 TEXT 改为 INTEGER，新增启动时自动迁移清理旧 "N.0" 数据。
- **分配/取消分配模型时 API Key 名称被清空**：`router.go` 的 PUT `/api/admin/api-keys/{id}` 将 `name`/`note` 解析为 Go 空字符串（而非 nil），导致 `COALESCE(?, name)` 被空串覆盖现有名称。修复：新增 `stringOrNil()` helper，请求未传 name 时传 nil → COALESCE 保留原有名称。

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
