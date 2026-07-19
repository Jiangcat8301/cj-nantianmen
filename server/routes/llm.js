import crypto from 'node:crypto'
import { getDb } from '../db/index.js'
import { getModelMap } from '../services/modelMap.js'
import { proxyRequest } from '../services/llmProxy.js'
import * as stats from '../services/stats.js'

function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex') }

async function authApiKey(req, reply) {
  const auth = req.headers['authorization'] || ''
  const token = auth.replace(/^Bearer\s+/i, '')
  if (!token || !token.startsWith('skm-')) return reply.code(401).send({ error: 'invalid api key' })
  const rows = await getDb().query(`SELECT id FROM api_keys WHERE key=?`, [token])
  if (rows.length === 0) return reply.code(401).send({ error: 'invalid api key' })
  req.apiKeyId = rows[0].id
  // touch last_used_at (ponytail: no-op if column absent; no big deal)
  await getDb().run("UPDATE api_keys SET last_used_at=datetime('now') WHERE id=?", [req.apiKeyId])
}

// ponytail: v0.2.14 — return 南天门对外 model 列表.
// 不带 apikey: 全量 (admin probe 用)
// 带 apikey: 默认模型 ∪ 授权列表 (系统默认模型对所有 key 可用)
async function buildModelsResponse(apiKeyId) {
  const map = getModelMap()
  const out = [{ id: 'Nantianmen-default', object: 'model', created: 0, owned_by: 'Nantianmen' }]
  out.push(...Object.entries(map).map(([id, entry]) => ({
    id, object: 'model', created: 0, owned_by: entry.provider.name,
  })))
  if (!apiKeyId) return { object: 'list', data: out }
  // ponytail: fetch authorized model ids, build set of 南天门对外 ids.
  // Authorization grant = explicit permission; absence = implicitly denied. Default model is unconditionally available.
  const rows = await getDb().query(`SELECT model_id FROM api_key_models WHERE api_key_id=?`, [apiKeyId])
  const allowedIds = new Set(rows.map(r => r.model_id))
  const filtered = out.filter(m => m.id === 'Nantianmen-default' || (() => {
    const entry = map[m.id]
    return entry && allowedIds.has(entry.__modelId)
  })())
  return { object: 'list', data: filtered }
}

export default async function llmRoutes(fastify) {
  fastify.get('/v1/health', async () => ({
    status: 'ok',
    service: 'nantianmen',
    active_requests: stats.getActive(),
  }))

  // ponytail: v0.2.14 — /v1/models accepts optional Bearer. No key = full list. Key = key-scoped list.
  // Header missing/unparseable still returns 200 with full list (backward compat for tools that probe anonymously).
  fastify.get('/v1/models', async (req) => {
    const auth = req.headers['authorization'] || ''
    const token = auth.replace(/^Bearer\s+/i, '')
    if (!token || !token.startsWith('skm-')) return buildModelsResponse(null)
    const rows = await getDb().query(`SELECT id FROM api_keys WHERE key=?`, [token])
    if (rows.length === 0) return buildModelsResponse(null)  // ponytail: invalid key treated as anonymous for /v1/models (probe endpoint)
    return buildModelsResponse(rows[0].id)
  })

  fastify.post('/v1/chat/completions', async (req, reply) => {
    await authApiKey(req, reply)
    if (reply.sent) return
    return proxyRequest(req.body, 'openai', req.apiKeyId, reply)
  })

  fastify.post('/v1/messages', async (req, reply) => {
    await authApiKey(req, reply)
    if (reply.sent) return
    return proxyRequest(req.body, 'anthropic', req.apiKeyId, reply)
  })

  fastify.get('/api/admin/stats', async (req) => {
    return stats.query(req.query || {})
  })
}
