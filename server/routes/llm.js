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

export default async function llmRoutes(fastify) {
  fastify.get('/v1/health', async () => ({
    status: 'ok',
    service: 'nantianmen',
    active_requests: stats.getActive(),
  }))

  fastify.get('/v1/models', async () => {
    const map = getModelMap()
    const data = [{ id: 'Nantianmen-default', object: 'model', created: 0, owned_by: 'Nantianmen' }]
    data.push(...Object.entries(map).map(([id, entry]) => ({
      id, object: 'model', created: 0, owned_by: entry.provider.name,
    })))
    return { object: 'list', data }
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
