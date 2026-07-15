import * as provider from '../services/provider.js'
import { getDb } from '../db/index.js'
import { rebuildModelMap } from '../services/modelMap.js'

function mask(k) {
  if (!k) return ''
  return k.length > 8 ? `${k.slice(0, 4)}...${k.slice(-4)}` : '***'
}

async function fetchAndRebuild(providerId) {
  // ponytail: best-effort fetch; ignore failure (some providers don't expose /models)
  const p = await provider.getProvider(providerId)
  if (!p) return []
  const url = p.base_url.replace(/\/+$/, '') + (p.protocol === 'openai' ? '/models' : '/v1/models')
  const headers = p.protocol === 'openai'
    ? { Authorization: `Bearer ${p.api_key}` }
    : { 'x-api-key': p.api_key, 'anthropic-version': '2023-06-01' }
  try {
    const resp = await fetch(url, { headers })
    if (!resp.ok) return []
    const data = await resp.json()
    const names = (data.data || []).map(m => m.id)
    if (names.length) {
      const db = getDb()
      for (const name of names) {
        await db.run('INSERT OR IGNORE INTO models(provider_id, model_name) VALUES (?,?)', [providerId, name])
      }
    }
  } catch {}
  await rebuildModelMap()
  return getDb().query('SELECT * FROM models WHERE provider_id=? ORDER BY id', [providerId])
}

export default async function providerRoutes(fastify) {
  fastify.get('/api/admin/providers', async () => {
    const rows = await provider.listProviders()
    return rows.map(p => ({ ...p, api_key: mask(p.api_key) }))
  })

  fastify.post('/api/admin/providers', async (req, reply) => {
    try {
      const created = await provider.createProvider(req.body || {})
      const models = await fetchAndRebuild(created.id)
      return { ...created, api_key: mask(created.api_key), models }
    } catch (e) {
      return reply.code(400).send({ error: e.message })
    }
  })

  fastify.put('/api/admin/providers/:id', async (req, reply) => {
    try {
      const updated = await provider.updateProvider(Number(req.params.id), req.body || {})
      if (!updated) return reply.code(404).send({ error: 'not found' })
      await rebuildModelMap()
      return { ...updated, api_key: mask(updated.api_key) }
    } catch (e) {
      return reply.code(400).send({ error: e.message })
    }
  })

  fastify.delete('/api/admin/providers/:id', async (req, reply) => {
    const ok = await provider.deleteProvider(Number(req.params.id))
    await rebuildModelMap()
    return ok ? { ok: true } : reply.code(404).send({ error: 'not found' })
  })

  fastify.post('/api/admin/providers/:id/health', async (req, reply) => {
    const p = await provider.getProvider(Number(req.params.id))
    if (!p) return reply.code(404).send({ error: 'not found' })
    const url = p.base_url.replace(/\/+$/, '') + (p.protocol === 'openai' ? '/models' : '/v1/models')
    const headers = p.protocol === 'openai'
      ? { Authorization: `Bearer ${p.api_key}` }
      : { 'x-api-key': p.api_key, 'anthropic-version': '2023-06-01' }
    try {
      const resp = await fetch(url, { headers })
      return { healthy: resp.ok, status_code: resp.status }
    } catch (e) {
      return { healthy: false, error: String(e) }
    }
  })

  fastify.get('/api/admin/providers/:id/models', async (req) => {
    return getDb().query('SELECT * FROM models WHERE provider_id=? ORDER BY id', [req.params.id])
  })

  fastify.post('/api/admin/providers/:id/models', async (req, reply) => {
    const { model_name } = req.body || {}
    if (!model_name || !model_name.trim()) return reply.code(400).send({ error: 'model_name required' })
    await getDb().run('INSERT OR IGNORE INTO models(provider_id, model_name, is_manual) VALUES (?,?,1)', [req.params.id, model_name.trim()])
    await rebuildModelMap()
    const rows = await getDb().query('SELECT * FROM models WHERE provider_id=? AND model_name=?', [req.params.id, model_name.trim()])
    return rows[0]
  })

  fastify.post('/api/admin/providers/:id/models/refresh', async (req) => {
    const models = await fetchAndRebuild(Number(req.params.id))
    return { ok: true, models }
  })

  fastify.put('/api/admin/providers/:id/models/:modelId/default', async (req, reply) => {
    const { providerId, modelId } = { providerId: Number(req.params.id), modelId: Number(req.params.modelId) }
    const db = getDb()
    const m = (await db.query('SELECT * FROM models WHERE id=? AND provider_id=?', [modelId, providerId]))[0]
    if (!m) return reply.code(404).send({ error: 'not found' })
    await db.run('UPDATE models SET is_default=0')
    await db.run('UPDATE models SET is_default=1 WHERE id=?', [modelId])
    return m
  })
}
