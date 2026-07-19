import { getDb } from '../db/index.js'

const buffer = new Map() // key: JSON.stringify(row) -> row sums
let active = 0
let lastFlush = Date.now()

// ponytail: bucket on model_id (FK) when present; fall back to (provider_id, model_name) for legacy rows.
// Single global lock (JS event loop) — fine for single-node deployment.
export function acquire() { active++ }
export function release() { if (active > 0) active-- }
export function getActive() { return active }

function bucketKey(r) {
  return `${r.api_key_id ?? ''}|${r.model_id ?? ''}|${r.provider_id ?? ''}|${r.model_name}`
}

export function record(r) {
  const k = bucketKey(r)
  const cur = buffer.get(k)
  if (cur) {
    cur.request_count += r.request_count ?? 1
    cur.input_tokens += r.input_tokens ?? 0
    cur.output_tokens += r.output_tokens ?? 0
    cur.cached_tokens += r.cached_tokens ?? 0
  } else {
    buffer.set(k, {
      api_key_id: r.api_key_id ?? null,
      provider_id: r.provider_id ?? null,
      model_id: r.model_id ?? null,
      model_name: r.model_name,
      request_count: r.request_count ?? 1,
      input_tokens: r.input_tokens ?? 0,
      output_tokens: r.output_tokens ?? 0,
      cached_tokens: r.cached_tokens ?? 0,
    })
  }
  if (Date.now() - lastFlush > 10000) flush()
}

export async function flush() {
  if (buffer.size === 0) return
  const rows = [...buffer.values()]
  buffer.clear()
  lastFlush = Date.now()
  const db = getDb()
  for (const r of rows) {
    await db.run(
      'INSERT INTO usage_stats(api_key_id, provider_id, model_id, model_name, request_count, input_tokens, output_tokens, cached_tokens) VALUES (?,?,?,?,?,?,?,?)',
      [r.api_key_id, r.provider_id, r.model_id ?? null, r.model_name, r.request_count, r.input_tokens, r.output_tokens, r.cached_tokens],
    )
  }
}

let interval = null
export function startFlushTask() {
  if (interval) return
  interval = setInterval(() => { flush().catch(() => {}) }, 10000)
}
export function stopFlushTask() {
  if (interval) clearInterval(interval)
  interval = null
}

export async function query({ provider_id, model_name, api_key_id, range }) {
  // ponytail: time-range filter so Dashboard/Stats show 'today' vs '7d' etc.
  // Use localtime to respect user timezone (SQLite date('now') is UTC).
  const where = []
  const params = []
  if (provider_id) { where.push('u.provider_id=?'); params.push(provider_id) }
  if (model_name) { where.push('u.model_name=?'); params.push(model_name) }
  if (api_key_id) { where.push('u.api_key_id=?'); params.push(api_key_id) }
  if (range === 'today') { where.push("datetime(u.created_at,'localtime') >= date('now','localtime')"); }
  else if (range === '7d') { where.push("datetime(u.created_at,'localtime') >= date('now','-7 days','localtime')"); }
  else if (range === '30d') { where.push("datetime(u.created_at,'localtime') >= date('now','-30 days','localtime')"); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : ''

  // ponytail: breakdown keeps per-key detail (admin table);
    // topModels/topProviders are pre-aggregated to dedupe same provider+model across multiple keys (#4).
    // v0.2.14: LEFT JOIN via model_id (FK) — picks up renamed models automatically.
    // For legacy rows (model_id IS NULL), fall back to (provider_id, model_name) lookup to keep price stats.
    const rows = await getDb().query(
      `SELECT p.name AS provider, u.model_name, u.api_key_id, k.name AS key_name,
              COALESCE(m.model_name, u.model_name) AS current_model_name,
              COALESCE(m.input_price, m_legacy.input_price, 0) AS input_price,
              COALESCE(m.output_price, m_legacy.output_price, 0) AS output_price,
              COALESCE(m.cache_hit_price, m_legacy.cache_hit_price, 0) AS cache_hit_price,
              SUM(u.request_count) AS request_count,
              SUM(u.input_tokens) AS input_tokens,
              SUM(u.output_tokens) AS output_tokens,
              SUM(u.cached_tokens) AS cached_tokens
       FROM usage_stats u
       LEFT JOIN providers p ON u.provider_id = p.id
       LEFT JOIN api_keys k ON u.api_key_id = k.id
       LEFT JOIN models m ON u.model_id = m.id
       LEFT JOIN models m_legacy ON u.model_id IS NULL AND u.provider_id = m_legacy.provider_id AND u.model_name = m_legacy.model_name
       ${w}
       GROUP BY u.provider_id, u.model_name, u.api_key_id
       ORDER BY request_count DESC`,
      params,
    )

  // ponytail: pre-aggregate by (provider, model) so the Top-5 panel doesn't show the same
  // provider/model multiple times when several API keys used it. One pass over `rows`.
  // Cost uses (input-cached)*input_price + output*output_price + cached*cache_hit_price (v0.2.7 Bug 24).
  const rowCost = (r) =>
    ((r.input_tokens || 0) - (r.cached_tokens || 0)) * (r.input_price || 0) / 1_000_000
    + (r.output_tokens || 0) * (r.output_price || 0) / 1_000_000
    + (r.cached_tokens || 0) * (r.cache_hit_price || 0) / 1_000_000
  const byModel = new Map()
  const byProvider = new Map()
  for (const r of rows) {
    const mk = `${r.provider}|${r.current_model_name || r.model_name}`
    const m = byModel.get(mk) || { provider: r.provider || '?', model: r.current_model_name || r.model_name || '?',
      request_count: 0, input_tokens: 0, output_tokens: 0, cached_tokens: 0,
      input_price: r.input_price || 0, output_price: r.output_price || 0, cache_hit_price: r.cache_hit_price || 0,
      cost: 0 }
    m.request_count += r.request_count || 0
    m.input_tokens += r.input_tokens || 0
    m.output_tokens += r.output_tokens || 0
    m.cached_tokens += r.cached_tokens || 0
    m.cost += rowCost(r)
    byModel.set(mk, m)

    const pk = r.provider || '?'
    // ponytail: don't carry a single model's price into the provider aggregate — different models
    // within the same provider have different prices (e.g. Deepseek v4-pro vs v4-flash). Sum cost
    // row-by-row using each row's own price; expose cost on the aggregate, drop the misleading price.
    const p = byProvider.get(pk) || { provider: pk, request_count: 0,
      input_tokens: 0, output_tokens: 0, cached_tokens: 0, cost: 0 }
    p.request_count += r.request_count || 0
    p.input_tokens += r.input_tokens || 0
    p.output_tokens += r.output_tokens || 0
    p.cached_tokens += r.cached_tokens || 0
    p.cost += rowCost(r)
    byProvider.set(pk, p)
  }
  const topModels = [...byModel.values()].sort((a, b) => (b.input_tokens + b.output_tokens) - (a.input_tokens + a.output_tokens)).slice(0, 5)
  const topProviders = [...byProvider.values()].sort((a, b) => (b.input_tokens + b.output_tokens) - (a.input_tokens + a.output_tokens)).slice(0, 5)

  let total_requests = 0, total_input_tokens = 0, total_output_tokens = 0, total_cached_tokens = 0
  for (const r of rows) {
    total_requests += r.request_count || 0
    total_input_tokens += r.input_tokens || 0
    total_output_tokens += r.output_tokens || 0
    total_cached_tokens += r.cached_tokens || 0
  }
  return { total_requests, total_input_tokens, total_output_tokens, total_cached_tokens, breakdown: rows, topModels, topProviders }
}