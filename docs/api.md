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
| GET/POST/PUT/DELETE | `/api/admin/api-keys` | Bearer M | API Key CRUD |
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
| GET  | `/v1/health` | 公开 | 健康检查 + active_requests |
| GET  | `/v1/models` | Bearer `skm-`（可选） | 模型列表（带 key 时按授权过滤，不带/无效 key 返回全量） |
| POST | `/v1/chat/completions` | Bearer `skm-` | OpenAI Chat Completions 入口 |
| POST | `/v1/messages` | Bearer `skm-` | Anthropic Messages 入口 |

> 当 Provider 协议与入站协议不一致时，流式响应实时转换格式（Anthropic SSE ↔ OpenAI SSE），无需 Agent 侧适配。
> **v0.2.14**：`/v1/chat/completions` 和 `/v1/messages` 在鉴权后检查该 key 是否有调用对应模型的授权，未授权返回 `403 model not authorized`。
