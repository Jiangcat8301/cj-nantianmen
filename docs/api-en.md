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
| GET/POST/PUT/DELETE | `/api/admin/api-keys` | Bearer M | API key CRUD (**v0.2.14 Fixed**: now JOINs the models table for assigned_model, no longer reads the dropped column) |
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
| GET | `/v1/health` | public | Health check + active_requests + **version (v0.2.14, used by Desktop/CLI strict handshake)** |
| GET | `/v1/models` | Bearer `skm-` (optional) | Model list (with key: authorization-filtered; without/invalid key: full list) |
| POST | `/v1/chat/completions` | Bearer `skm-` | OpenAI Chat Completions entry |
| POST | `/v1/messages` | Bearer `skm-` | Anthropic Messages entry |
| POST | `/v1/embeddings` | Bearer `skm-` | **v0.3.15+** OpenAI Embeddings entry (OpenAI-protocol providers only) |

> When Provider protocol differs from inbound protocol, streaming responses are real-time converted (Anthropic SSE ↔ OpenAI SSE). No Agent-side adaptation needed.
> **v0.2.14**: `/v1/chat/completions` and `/v1/messages` check model authorization after auth; unauthorized models return `403 model not authorized`.  
> **v0.2.14 (Fixed)**: `/v1/health` returns a new `version` field (read from `server/package.json`) used by Desktop/CLI for strict version handshake. `GET/POST/PUT /api/admin/api-keys` and the `/v1/messages` proxy path no longer read the dropped `api_keys.assigned_model` column; they LEFT JOIN `models.m.model_name` AS assigned_model instead.

### /v1/embeddings (v0.3.15+)

Request format matches OpenAI `/v1/embeddings`; Nantianmen forwards only the whitelist fields: `model`, `input` (`string | string[]`), `encoding_format`, `dimensions`, `user`. Other fields are stripped before forwarding.

Auth & authorization: Bearer `skm-...`, sharing the same authorization system as chat. **`assigned_model_id` does not apply** (chat-only). `/v1/embeddings` requires an explicit `body.model`; `auto` / `Nantianmen-default` return `400`.

Provider restriction: only OpenAI-protocol providers are supported. Anthropic-protocol providers return `400 embedding only supports openai protocol`.

Billing: only `prompt_tokens` is counted; `output_tokens` / `cached_tokens` are recorded as 0. The `models.input_price` field is the per-token price for embedding.

Not supported: streaming (SSE), vector caching; when `encoding_format='base64'` the metadata `dim` is `null`.

Communication log: `communication_log.output` **does not store the vector body**, only metadata `{model, dim, count, format, tokens}` — this prevents 1024-dim × N-call writes from bloating SQLite.

Example:
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

Error codes:
- `400 /v1/embeddings requires explicit model (no auto, no default)` — `body.model` missing or `auto`/`Nantianmen-default`
- `400 model '<id>' is not an embedding model` — model `capability='chat'`
- `400 embedding only supports openai protocol` — provider protocol is anthropic
- `400 capability must be chat or embedding` — admin API model-add received invalid capability
- `403 model not authorized` — the api-key is not authorized for this embedding model (shares the chat authorization hook)
