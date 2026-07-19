import crypto from 'node:crypto'
import { getDb } from '../db/index.js'
import * as commlog from '../services/commlog.js'

function genKey() {
  // skm- + 40 hex chars
  return 'skm-' + crypto.randomBytes(20).toString('hex')
}

// ponytail: bulk replace api_key_models rows for a key (v0.2.14 授权列表).
// Empty array clears all grants. O(n) for small n; switch to upsert batch if n grows past ~100.
async function setKeyModels(apiKeyId, modelIds) {
  await getDb().run('DELETE FROM api_key_models WHERE api_key_id=?', [apiKeyId])
  if (!Array.isArray(modelIds) || modelIds.length === 0) return
  const db = getDb()
  for (const mid of modelIds) {
    if (mid == null) continue
    await db.run('INSERT OR IGNORE INTO api_key_models(api_key_id, model_id) VALUES (?,?)', [apiKeyId, Number(mid)])
  }
}

// ponytail: read authorized model ids for a key, plus provider/model names via JOIN.
async function getKeyModels(apiKeyId) {
  const rows = await getDb().query(
    `SELECT akm.model_id, m.model_name, p.name AS provider_name
     FROM api_key_models akm
     JOIN models m ON m.id = akm.model_id
     JOIN providers p ON p.id = m.provider_id
     WHERE akm.api_key_id=?`,
    [apiKeyId]
  )
  return rows
}

export default async function apikeyRoutes(fastify) {
  // ponytail: LEFT JOIN assigned_model_id + fallback to legacy assigned_model TEXT (kept for compat).
  // Also expose `authorized_models` so admin UI can render the per-key grant list in one round trip.
  fastify.get('/api/admin/api-keys', async () => {
    const rows = await getDb().query(
      `SELECT a.id, a.key, a.name, a.note, a.assigned_model_id,
              COALESCE(am.model_name, a.assigned_model) AS assigned_model,
              am.provider_id AS assigned_provider_id,
              ap.name AS assigned_provider_name,
              datetime(a.created_at,'localtime') as created_at,
              datetime(a.last_used_at,'localtime') as last_used_at
       FROM api_keys a
       LEFT JOIN models am ON am.id = a.assigned_model_id
       LEFT JOIN providers ap ON ap.id = am.provider_id
       ORDER BY a.id`
    )
    const out = []
    for (const r of rows) {
      out.push({ ...r, authorized_models: await getKeyModels(r.id) })
    }
    return out
  })

  fastify.post('/api/admin/api-keys', async (req) => {
    const { name = '', note = '', assigned_model_id = null, model_ids = [] } = req.body || {}
    const key = genKey()
    const r = await getDb().run(
      'INSERT INTO api_keys(key, name, note, assigned_model_id) VALUES (?,?,?,?)',
      [key, name, note, assigned_model_id ? Number(assigned_model_id) : null]
    )
    await setKeyModels(r.lastInsertRowid, model_ids)
    const rows = await getDb().query(
      `SELECT a.id, a.key, a.name, a.note, a.assigned_model_id,
              COALESCE(am.model_name, a.assigned_model) AS assigned_model,
              datetime(a.created_at,'localtime') as created_at
       FROM api_keys a
       LEFT JOIN models am ON am.id = a.assigned_model_id
       WHERE a.id=?`,
      [r.lastInsertRowid]
    )
    return { ...rows[0], authorized_models: await getKeyModels(r.lastInsertRowid) }
  })

  fastify.put('/api/admin/api-keys/:id', async (req, reply) => {
    const { name, note, old_name, assigned_model_id, model_ids } = req.body || {}
    // ponytail: if name changed, update all log entries with the old name
    if (name && old_name && name !== old_name) commlog.renameUser(old_name, name)
    // ponytail: assigned_model_id — when explicitly null, clear override; when absent, leave as-is.
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'assigned_model_id')) {
      await getDb().run(
        'UPDATE api_keys SET name=COALESCE(?, name), note=COALESCE(?, note), assigned_model_id=? WHERE id=?',
        [name, note, assigned_model_id ? Number(assigned_model_id) : null, req.params.id]
      )
    } else {
      await getDb().run(
        'UPDATE api_keys SET name=COALESCE(?, name), note=COALESCE(?, note) WHERE id=?',
        [name, note, req.params.id]
      )
    }
    // ponytail: model_ids only updated when caller explicitly sends the array (PUT as full-state replace).
    if (Array.isArray(model_ids)) await setKeyModels(req.params.id, model_ids)
    const rows = await getDb().query(
      `SELECT a.id, a.key, a.name, a.note, a.assigned_model_id,
              COALESCE(am.model_name, a.assigned_model) AS assigned_model,
              datetime(a.created_at,'localtime') as created_at,
              datetime(a.last_used_at,'localtime') as last_used_at
       FROM api_keys a
       LEFT JOIN models am ON am.id = a.assigned_model_id
       WHERE a.id=?`,
      [req.params.id]
    )
    if (!rows[0]) return reply.code(404).send({ error: 'not found' })
    return { ...rows[0], authorized_models: await getKeyModels(req.params.id) }
  })

  fastify.delete('/api/admin/api-keys/:id', async (req, reply) => {
    const r = await getDb().run('DELETE FROM api_keys WHERE id=?', [req.params.id])
    return r.changes ? { ok: true } : reply.code(404).send({ error: 'not found' })
  })

  // ponytail: v0.2.14 — 列出当前所有可用 model 给前端多选下拉。
  // 不过滤 is_disabled / deleted_at: UI 让 admin 也能看到已禁用 model 并按需授权 (授权后如 model 真删, FK CASCADE 自动撤销)。
  fastify.get('/api/admin/api-keys/available-models', async () => {
    return await getDb().query(
      `SELECT m.id, m.model_name, m.is_default, m.is_disabled, m.deleted_at,
              p.id AS provider_id, p.name AS provider_name, p.protocol
       FROM models m
       JOIN providers p ON p.id = m.provider_id
       ORDER BY p.name, m.model_name`
    )
  })
}
