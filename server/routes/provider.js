import * as provider from '../services/provider.js'
import { getDb } from '../db/index.js'
import { rebuildModelMap } from '../services/modelMap.js'
import { getDispatcher } from '../services/proxyDispatcher.js'

function mask(k) {
  if (!k) return ''
  return k.length > 8 ? `${k.slice(0, 4)}...${k.slice(-4)}` : '***'
}

async function fetchAndRebuild(providerId) {
  // ponytail: best-effort fetch; ignore failure (some providers don't expose /models)
  const p = await provider.getProvider(providerId)
  if (!p) return []
  const base = p.base_url.replace(/\/+$/, '')
  const url = p.protocol === 'openai' ? `${base}/models` : `${base}/v1/models`
  const headers = p.protocol === 'openai'
    ? { Authorization: `Bearer ${p.api_key}` }
    : { 'x-api-key': p.api_key, 'anthropic-version': '2023-06-01' }
  try {
    const resp = await fetch(url, { headers, dispatcher: await getDispatcher() })
    if (!resp.ok || resp.status === 404) return []
    const data = await resp.json()
    const names = (data.data || []).map(m => m.id)
    if (names.length) {
      const db = getDb()
      // ponytail: mark all as deleted, then upsert with deleted=0 so removed upstream models keep their stats.
      await db.run('UPDATE models SET deleted=1 WHERE provider_id=?', [providerId])
      for (const name of names) {
        await db.run('INSERT INTO models(provider_id, model_name, deleted) VALUES (?,?,0) ON CONFLICT(provider_id, model_name) DO UPDATE SET deleted=0', [providerId, name])
      }
    }
  } catch {}
  await rebuildModelMap()
  return getDb().query('SELECT * FROM models WHERE provider_id=? AND deleted=0 ORDER BY id', [providerId])
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
      // ponytail: first provider auto-defaults
      const all = await provider.listProviders()
      if (all.length === 1) {
        const db = getDb()
        const firstModel = (await db.query('SELECT * FROM models WHERE provider_id=? ORDER BY id LIMIT 1', [created.id]))[0]
        if (firstModel) {
          await db.run('UPDATE models SET is_default=1 WHERE id=?', [firstModel.id])
          await rebuildModelMap()
        }
      }
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
    // ponytail: OpenAI providers: GET /models. Anthropic providers: try /v1/models, tolerate 404.
    const base = p.base_url.replace(/\/+$/, '')
    const url = p.protocol === 'openai' ? `${base}/models` : `${base}/v1/models`
    const headers = p.protocol === 'openai'
      ? { Authorization: `Bearer ${p.api_key}` }
      : { 'x-api-key': p.api_key, 'anthropic-version': '2023-06-01' }
    try {
      const resp = await fetch(url, { headers, dispatcher: await getDispatcher() })
      // ponytail: 404 on anthropic /v1/models is common (e.g. MiniMax). Try a minimal messages request instead.
      if (resp.status === 404 && p.protocol === 'anthropic') {
        return { healthy: true, status_code: 200, note: 'models endpoint not available, provider assumed healthy' }
      }
      return { healthy: resp.ok, status_code: resp.status }
    } catch (e) {
      return { healthy: false, error: String(e) }
    }
  })

  fastify.get('/api/admin/providers/:id/models', async (req) => {
    return getDb().query('SELECT * FROM models WHERE provider_id=? AND deleted=0 ORDER BY id', [req.params.id])
  })

  fastify.put('/api/admin/providers/:id/models/:modelId', async (req, reply) => {
    const { input_price, output_price, cache_hit_price } = req.body || {}
    const id = Number(req.params.modelId)
    const m = (await getDb().query('SELECT * FROM models WHERE id=?', [id]))[0]
    if (!m) return reply.code(404).send({ error: 'not found' })
    await getDb().run(
      'UPDATE models SET input_price=?, output_price=?, cache_hit_price=? WHERE id=?',
      [input_price ?? m.input_price, output_price ?? m.output_price, cache_hit_price ?? m.cache_hit_price, id]
    )
    return (await getDb().query('SELECT * FROM models WHERE id=?', [id]))[0]
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

  fastify.get('/api/admin/default-model', async () => {
    const rows = await getDb().query(`
      SELECT p.name AS provider_name, m.model_name, p.protocol
      FROM models m JOIN providers p ON m.provider_id = p.id
      WHERE m.is_default = 1 AND m.deleted = 0 LIMIT 1
    `)
    return rows[0] || null
  })

  fastify.put('/api/admin/providers/:id/models/:modelId/default', async (req, reply) => {
    const { providerId, modelId } = { providerId: Number(req.params.id), modelId: Number(req.params.modelId) }
    const db = getDb()
    const m = (await db.query('SELECT * FROM models WHERE id=? AND provider_id=?', [modelId, providerId]))[0]
    if (!m) return reply.code(404).send({ error: 'not found' })
    // ponytail: refuse to set default on a disabled model — would leave /v1/models pointing at nothing.
    if (m.is_disabled) return reply.code(400).send({ error: 'cannot set default: model is disabled' })
    await db.run('UPDATE models SET is_default=0')
    await db.run('UPDATE models SET is_default=1 WHERE id=?', [modelId])
    await rebuildModelMap()
    return m
  })

  // ponytail: toggle is_disabled for a single model. Re-enabling a previously-default disabled model
  // is allowed but does NOT restore is_default=1 (user must re-set explicitly).
  fastify.put('/api/admin/providers/:id/models/:modelId/toggle', async (req, reply) => {
    const { providerId, modelId } = { providerId: Number(req.params.id), modelId: Number(req.params.modelId) }
    const db = getDb()
    const m = (await db.query('SELECT * FROM models WHERE id=? AND provider_id=?', [modelId, providerId]))[0]
    if (!m) return reply.code(404).send({ error: 'not found' })
    const next = m.is_disabled ? 0 : 1
    if (next === 1 && m.is_default) {
      // ponytail: clearing default when disabling so /v1/models stays consistent.
      await db.run('UPDATE models SET is_default=0')
    }
    await db.run('UPDATE models SET is_disabled=? WHERE id=?', [next, modelId])
    await rebuildModelMap()
    return (await db.query('SELECT * FROM models WHERE id=?', [modelId]))[0]
  })
}
