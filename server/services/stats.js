import { getDb } from '../db/index.js'

const buffer = new Map() // key: JSON.stringify(row) -> row sums
let active = 0
let lastFlush = Date.now()

// ponytail: append-only log model, periodic flush, in-memory active counter.
// Single global lock (JS event loop) — fine for single-node deployment.
export function acquire() { active++ }
export function release() { if (active > 0) active-- }
export function getActive() { return active }

function bucketKey(r) {
  return `${r.api_key_id ?? ''}|${r.provider_id ?? ''}|${r.model_name}`
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
      'INSERT INTO usage_stats(api_key_id, provider_id, model_name, request_count, input_tokens, output_tokens, cached_tokens) VALUES (?,?,?,?,?,?,?)',
      [r.api_key_id, r.provider_id, r.model_name, r.request_count, r.input_tokens, r.output_tokens, r.cached_tokens],
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

export async function query({ provider_id, model_name, api_key_id }) {
  // ponytail: SUM-based aggregation, 5-table join only if filters are present.
  const where = []
  const params = []
  if (provider_id) { where.push('provider_id=?'); params.push(provider_id) }
  if (model_name) { where.push('model_name=?'); params.push(model_name) }
  if (api_key_id) { where.push('api_key_id=?'); params.push(api_key_id) }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : ''
  return getDb().query(
    `SELECT provider_id, model_name, api_key_id,
            SUM(request_count) AS request_count,
            SUM(input_tokens) AS input_tokens,
            SUM(output_tokens) AS output_tokens,
            SUM(cached_tokens) AS cached_tokens
     FROM usage_stats ${w}
     GROUP BY provider_id, model_name, api_key_id
     ORDER BY request_count DESC`,
    params,
  )
}
