// Provider CRUD + name validation. Mirrors the existing Python logic.
import { getDb } from '../db/index.js'

function validateName(name) {
  if (!name || /\s/.test(name) || name.includes('_')) {
    throw new Error('Provider name must not be empty, contain spaces, or underscores')
  }
}

async function listProviders() {
  return getDb().query('SELECT * FROM providers ORDER BY id')
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
  const merged = { ...existing, name: name ?? existing.name, protocol: protocol ?? existing.protocol, base_url: base_url ?? existing.base_url, api_key: api_key ?? existing.api_key }
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
