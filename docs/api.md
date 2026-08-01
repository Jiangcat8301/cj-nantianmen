# API 文档

南天门提供两类 HTTP 接口：

- **Admin API**：管理 provider、模型、API Key、统计、日志等
- **LLM Proxy API**：OpenAI / Anthropic 兼容的推理入口

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
| PUT | `/api/admin/providers/:id/models/:mid/default` | Bearer M | 设置默认模型 |
| PUT | `/api/admin/providers/:id/models/:mid` | Bearer M | 编辑模型定价 |
| POST | `/api/admin/providers/:id/models/refresh` | Bearer M | 重新拉取 Provider 模型列表 |
| POST | `/api/admin/providers/:id/models` | Bearer M | 手动添加 model 名称 |
| GET/POST/PUT/DELETE | `/api/admin/api-keys` | Bearer M | API Key CRUD（**v0.2.14 Fixed**：已改为 JOIN models 表读取 assigned_model，不再读旧列） |
| GET  | `/api/admin/api-keys/available-models` | Bearer M | 列出可授权模型（已排除停用/删除） |
| GET  | `/api/admin/stats` | Bearer M | 用量聚合（支持 `?range=today\|7d\|30d`） |
| GET  | `/api/admin/default-model` | Bearer M | 获取默认路由模型 |
| GET  | `/api/admin/communication-log` | Bearer M | 查询通信日志（支持 `?provider_id=&model_name=&user_id=`） |
| DELETE | `/api/admin/communication-log` | Bearer M | 清空通信日志 |
| GET/PUT | `/api/admin/communication-log/config` | Bearer M | 日志开关 |
| POST | `/api/admin/server/{shutdown,restart}` | Bearer M | 进程控制 |

管理 API 除白名单外都要求：

```
Authorization: Bearer ***
其中 M = md5(RAWPASSWORD)，server 端校验 md5(M + conf.salt) == conf.password
```

### API Key 授权模型 (v0.2.14)

- `POST /api/admin/api-keys` 接受 `model_ids: [1, 3]` 数组，为新建 key 指定授权模型
- `PUT /api/admin/api-keys/:id` 接受 `model_ids` 数组（全量替换）和 `assigned_model_id` 整数
- `GET /api/admin/api-keys` 返回 `authorized_models: [{model_id, provider_name, model_name}]` 和 `assigned_model_id`
- `GET /api/admin/api-keys/available-models` 返回当前可用的模型列表（不含已停用/已删除，已存在授权不撤回）

## LLM Proxy API

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| GET  | `/v1/health` | 公开 | 健康检查 + active_requests + **version（v0.2.14，Desktop/CLI 严格握手用）** |
| GET  | `/v1/models` | Bearer `skm-`（可选） | 模型列表（带 key 时按授权过滤，不带/无效 key 返回全量） |
| POST | `/v1/chat/completions` | Bearer `skm-` | OpenAI Chat Completions 入口 |
| POST | `/v1/messages` | Bearer `skm-` | Anthropic Messages 入口 |
| POST | `/v1/embeddings` | Bearer `skm-` | **v0.3.15+** OpenAI Embeddings 入口（仅 OpenAI 协议 provider） |

> 当 Provider 协议与入站协议不一致时，流式响应实时转换格式（Anthropic SSE ↔ OpenAI SSE），无需 Agent 侧适配。
> **v0.2.14**：`/v1/chat/completions` 和 `/v1/messages` 在鉴权后检查该 key 是否有调用对应模型的授权，未授权返回 `403 model not authorized`。  
> **v0.2.14 (Fixed)**：`/v1/health` 返回新增 `version` 字段（读取 `server/package.json`），用于 Desktop/CLI 严格版本握手。`GET/POST/PUT /api/admin/api-keys` 与 `/v1/messages` 代理路径不再读取已 DROP 的 `api_keys.assigned_model` 列，统一改为 LEFT JOIN `models.m.model_name` AS assigned_model。

### /v1/embeddings（v0.3.15+）

请求格式与 OpenAI `/v1/embeddings` 一致；南天门只透传白名单字段：`model`、`input`（`string | string[]`）、`encoding_format`、`dimensions`、`user`，其他字段会被剥离后转发。

鉴权与授权：Bearer `skm-...`，与 chat 模型共用同一授权体系。**`assigned_model_id` 不适用**（仅影响 chat）。`/v1/embeddings` 必须显式 `body.model`，不接受 `auto` / `Nantianmen-default`，否则返回 `400`。

Provider 限制：仅 OpenAI 协议 provider 支持。`anthropic` 协议 provider 返回 `400 embedding only supports openai protocol`。

计费：仅 `prompt_tokens` 入账，`output_tokens` / `cached_tokens` 一律记 0。`models.input_price` 字段即为 embedding 的 token 单价。

不支持：流式（SSE）、向量缓存、`encoding_format='base64'` 时元数据 `dim` 为 `null`。

通信日志：`communication_log.output` **不存向量本体**，仅记元数据 `{model, dim, count, format, tokens}`，避免 1024 维 × N 次调用撑爆 SQLite。

示例：
```bash
curl -X POST http://127.0.0.1:38271/v1/embeddings \
  -H "Authorization: Bearer skm-..." \
  -H "Content-Type: application/json" \
  -d '{"model":"OpenAI_text-embedding-3-small","input":"hello world"}'
```
```json
{
  "object": "list",
  "data": [
    {"object": "embedding", "embedding": [0.0123, -0.0456, ...], "index": 0}
  ],
  "model": "text-embedding-3-small",
  "usage": {"prompt_tokens": 2, "total_tokens": 2}
}
```

错误码：
- `400 /v1/embeddings requires explicit model (no auto, no default)` — `body.model` 缺失或为 `auto`/`Nantianmen-default`
- `400 model '<id>' is not an embedding model` — 该模型 `capability='chat'`
- `400 embedding only supports openai protocol` — Provider 协议为 anthropic
- `400 capability must be chat or embedding` — Admin API 添加模型时 capability 取值非法
- `403 model not authorized` — 该 api-key 未授权该 embedding 模型（与 chat 鉴权复用同一 hook）
