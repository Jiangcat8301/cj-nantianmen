import { getDb } from '../db/index.js'

// ponytail: full-rebuild on every change. Confirmed safe for ≤10k models;
// switch to incremental updates if a real deployment grows that big.
let _map = {}

function computeEndpoint(p) {
  const base = p.base_url.replace(/\/+$/, '')
  return p.protocol === 'openai' ? `${base}/chat/completions` : `${base}/v1/messages`
}

function computeHeaders(p) {
  if (p.protocol === 'openai') {
    return { Authorization: `Bearer ${p.api_key}`, 'Content-Type': 'application/json' }
  }
  return { 'x-api-key': p.api_key, 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01' }
}

export async function rebuildModelMap() {
  const db = getDb()
  const providers = await db.query('SELECT * FROM providers')
  const pMap = Object.fromEntries(providers.map(p => [p.id, p]))
  const models = await db.query('SELECT * FROM models')
  const next = {}
  for (const m of models) {
    const p = pMap[m.provider_id]
    if (!p) continue
    const key = `${p.name}_${p.protocol}_${m.model_name}`
    next[key] = {
      provider: p,
      model_name: m.model_name,
      protocol: p.protocol,
      endpoint: computeEndpoint(p),
      headers: computeHeaders(p),
    }
  }
  _map = next
  return _map
}

export function getModelMap() {
  return _map
}

export function getEntry(modelField) {
  return _map[modelField] || null
}
