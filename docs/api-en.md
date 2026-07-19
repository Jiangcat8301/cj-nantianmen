# API Reference

Nantianmen exposes two classes of HTTP endpoints:

- **Admin API** — manage providers, models, API keys, stats, and communication logs
- **LLM Proxy API** — OpenAI / Anthropic compatible inference entry points

## Admin API Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/admin/status` | public | Returns `initialized` flag |
| POST | `/api/admin/setup` | public (uninitialized only) | First-time initialization |
| POST | `/api/admin/login` | public (initialized only) | Verify saved md5 still works |
| POST | `/api/admin/password/change` | Bearer M | Change password + regenerate salt |
| POST | `/api/admin/database/configure` | Bearer M | Switch DB backend (restart required) |
| GET/PUT | `/api/admin/settings` | Bearer M | Read/write host + port |
| GET/POST/PUT/DELETE | `/api/admin/providers` | Bearer M | Provider CRUD |
| PUT | `/api/admin/providers/:id/models/:mid/default` | Bearer M | Set default model |
| PUT | `/api/admin/providers/:id/models/:mid` | Bearer M | Edit model pricing |
| POST | `/api/admin/providers/:id/models/refresh` | Bearer M | Re-fetch provider model list |
| POST | `/api/admin/providers/:id/models` | Bearer M | Manually add a model name |
| GET/POST/PUT/DELETE | `/api/admin/api-keys` | Bearer M | API key CRUD |
| GET | `/api/admin/api-keys/available-models` | Bearer M | List grantable models (excludes disabled/deleted) |
| GET | `/api/admin/stats` | Bearer M | Usage aggregation (`?range=today\|7d\|30d`) |
| GET | `/api/admin/default-model` | Bearer M | Get default routing model |
| GET | `/api/admin/communication-log` | Bearer M | Query comm log (`?provider_id=&model_name=&user_id=`) |
| DELETE | `/api/admin/communication-log` | Bearer M | Clear comm log |
| GET/PUT | `/api/admin/communication-log/config` | Bearer M | Log toggle |
| POST | `/api/admin/server/{shutdown,restart}` | Bearer M | Process control |

All admin endpoints except the whitelist require:

```
Authorization: Bearer ***
where M = md5(RAWPASSWORD); server checks md5(M + conf.salt) == conf.password
```

### API Key Model Authorization (v0.2.14)

- `POST /api/admin/api-keys` accepts `model_ids: [1, 3]` array to grant models to a new key
- `PUT /api/admin/api-keys/:id` accepts `model_ids` array (full replacement) and `assigned_model_id` integer
- `GET /api/admin/api-keys` returns `authorized_models: [{model_id, provider_name, model_name}]` and `assigned_model_id`
- `GET /api/admin/api-keys/available-models` returns currently grantable models (excludes disabled/deleted; existing grants are not revoked)

## LLM Proxy API

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/v1/health` | public | Health check + active_requests |
| GET | `/v1/models` | Bearer `skm-` (optional) | Model list (with key: authorization-filtered; without/invalid key: full list) |
| POST | `/v1/chat/completions` | Bearer `skm-` | OpenAI Chat Completions entry |
| POST | `/v1/messages` | Bearer `skm-` | Anthropic Messages entry |

> When Provider protocol differs from inbound protocol, streaming responses are real-time converted (Anthropic SSE ↔ OpenAI SSE). No Agent-side adaptation needed.
> **v0.2.14**: `/v1/chat/completions` and `/v1/messages` check model authorization after auth; unauthorized models return `403 model not authorized`.
