// Provider CRUD + name validation. Mirrors the existing Python logic.
import { getDb } from '../db/index.js'

function validateName(name) {
  if (!name || /\s/.test(name) || name.includes('_')) {
    throw new Error('Provider name must not be empty, contain spaces, or underscores')
  }
}

// ponytail: v0.3.15 — embed nested models so Dashboard can detect embedding capability
// without a second round-trip. Excludes deleted models; keeps capability field for UI.
async function listProviders() {
  const providers = await getDb().query('SELECT * FROM providers WHERE deleted_at IS NULL ORDER BY id')
  if (providers.length === 0) return providers
  const ids = providers.map(p => p.id)
  const placeholders = ids.map(() => '?').join(',')
  const models = await getDb().query(
    `SELECT id, provider_id, model_name, capability, is_default, is_disabled
     FROM models
     WHERE deleted_at IS NULL AND provider_id IN (${placeholders})
     ORDER BY provider_id, id`,
    ids,
  )
  const byP = new Map(providers.map(p => [p.id, p]))
  for (const m of models) {
    const p = byP.get(m.provider_id)
    if (!p) continue
    if (!Array.isArray(p.models)) p.models = []
    p.models.push(m)
  }
  return providers
}

async function getProvider(id) {
  const rows = await getDb().query('SELECT * FROM providers WHERE id=?', [id])
  return rows[0] || null
}

async function createProvider({ name, protocol, base_url, api_key }) {
  validateName(name)
  if (protocol !== 'openai' && protocol !== 'anthropic') throw new Error("protocol must be 'openai' or 'anthropic'")
  const r = await getDb().run(
    'INSERT INTO providers(name, protocol, base_url, api_key) VALUES (?,?,?,?)',
    [name, protocol, base_url, api_key || ''],
  )
  const rows = await getDb().query('SELECT * FROM providers WHERE id=?', [r.lastInsertRowid])
  return rows[0]
}

async function updateProvider(id, { name, protocol, base_url, api_key }) {
  if (name !== undefined) validateName(name)
  const existing = await getProvider(id)
  if (!existing) return null
  const merged = { ...existing, name: name ?? existing.name, protocol: protocol ?? existing.protocol, base_url: base_url ?? existing.base_url, api_key: api_key || existing.api_key }
  await getDb().run(
    "UPDATE providers SET name=?, protocol=?, base_url=?, api_key=?, updated_at=datetime('now') WHERE id=?",
    [merged.name, merged.protocol, merged.base_url, merged.api_key, id],
  )
  return getProvider(id)
}

async function deleteProvider(id) {
  const r = await getDb().run('DELETE FROM providers WHERE id=?', [id])
  return r.changes > 0
}

export { listProviders, getProvider, createProvider, updateProvider, deleteProvider, validateName }
