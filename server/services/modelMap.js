import { getDb } from '../db/index.js'

// ponytail: full-rebuild on every change. Confirmed safe for ≤10k models;
// switch to incremental updates if a real deployment grows that big.
let _map = {}
let _defaultEntry = null

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
  // ponytail: is_disabled excludes model from /v1/models and llmProxy dispatch. Treat NULL as 0 (old rows).
  const models = await db.query('SELECT * FROM models WHERE deleted_at IS NULL AND (is_disabled IS NULL OR is_disabled=0)')
  const next = {}
  let defaultEntry = null
  for (const m of models) {
    const p = pMap[m.provider_id]
    if (!p) continue
    const key = `${p.name}_${m.model_name}`
    // ponytail: entry 携带 models.id, 让写入路径 (commlog/usage_stats/assigned_model) 不用再回查
    const entry = {
      __modelId: m.id,
      __isDefault: !!m.is_default,
      provider: p,
      model_name: m.model_name,
      protocol: p.protocol,
      endpoint: computeEndpoint(p),
      headers: computeHeaders(p),
    }
    next[key] = entry
    if (m.is_default) defaultEntry = entry
  }
  _map = next
  _defaultEntry = defaultEntry
  return _map
}

export function getModelMap() {
  return _map
}

export function getDefaultEntry() {
  if (_defaultEntry) return _defaultEntry
  // ponytail: fallback to first model if no is_default=1 set
  return Object.values(_map)[0] || null
}

export function getEntry(modelField) {
  return _map[modelField] || null
}

// ponytail: v0.2.14 — single source of truth for which entry proxyRequest will use.
// Mirrors resolveModel() in llmProxy.js. Returns null when caller should get a 403/404.
export function resolveEntryFor({ assignedModelId, bodyModel }) {
  const map = getModelMap()
  if (assignedModelId) {
    return Object.values(map).find(e => e.__modelId === assignedModelId) || null
  }
  const field = bodyModel || 'auto'
  if (field === 'auto' || field === 'Nantikanmen-default' || field === 'Nantianmen-default' || !field) {
    return getDefaultEntry()
  }
  return getEntry(field) || null
}
