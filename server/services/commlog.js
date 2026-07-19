// ponytail: communication log stored in SQLite.
// v0.2.7: buffered writes — append() queues to memory, flush() bulk-inserts every 10s.
// Rotation support: when log_rotation_enabled, trim to log_rotation_max on flush.
import { getConf } from '../conf.js'
import { getDb } from '../db/index.js'

const ROTATION_DEFAULT_MAX = 500

// ── buffer ──
let _buf = []
let _flushTimer = null
const FLUSH_INTERVAL_MS = 10_000

function rotationEnabled() {
  const c = getConf()
  return !!(c.log_rotation_enabled)
}
function rotationMax() {
  const c = getConf()
  return parseInt(c.log_rotation_max) || ROTATION_DEFAULT_MAX
}

export async function flushBuffer() {
  if (_buf.length === 0) return
  const batch = _buf
  _buf = []
  try {
    const db = getDb()
    // ponytail: batch insert — one INSERT per entry, wrapped in a transaction
    for (const entry of batch) {
      await db.run(
        `INSERT INTO communication_log (request_id, time, user_id, user_name, provider_id, provider_name, model_id, model_name, tokens_input, tokens_output, tokens_cached, duration_ms, input, output, error_code, error_message)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [entry.request_id || '', entry.time || '', entry.user_id || '', entry.user_name || '', entry.provider_id || 0, entry.provider_name || '', entry.model_id || null, entry.model_name || '',
         entry.tokens_input || 0, entry.tokens_output || 0, entry.tokens_cached || 0,
         entry.duration_ms ?? null,
         entry.input || '', entry.output || '', entry.error?.code || null, entry.error?.message || null]
      )
    }
    // ponytail: rotation — trim oldest rows beyond max (by id, stable under same-time inserts)
    if (rotationEnabled()) {
      const max = rotationMax()
      if (max > 0) await trimToMax(max)
    }
  } catch (e) {
    console.error('[commlog] flush failed:', e.message)
  }
}

export function initBuffer() {
  if (_flushTimer) return
  _flushTimer = setInterval(flushBuffer, FLUSH_INTERVAL_MS)
  process.on('beforeExit', () => flushBuffer())
  // ponytail: graceful shutdown on SIGTERM (tray quit → main.cjs kill SIGTERM)
  process.on('SIGTERM', async () => { await flushBuffer(); process.exit(0) })
  console.log(`[commlog] buffer init, flush every ${FLUSH_INTERVAL_MS / 1000}s`)
}

// ponytail: trim table to at most `max` rows, keeping newest by id (#6).
// Returns number of rows deleted. Safe to call when count <= max (no-op).
export async function trimToMax(max) {
  if (!max || max < 0) return 0
  const n = parseInt(max) || 0
  if (n === 0) return 0
  const db = getDb()
  const count = (await db.query(`SELECT COUNT(*) as c FROM communication_log`))[0]?.c || 0
  if (count <= n) return 0
  const del = count - n
  await db.run(`DELETE FROM communication_log WHERE id IN (SELECT id FROM communication_log ORDER BY id ASC LIMIT ?)`, [del])
  return del
}

export async function append(entry) {
  if (!getConf().log_enabled) return
  _buf.push(entry)
}

export async function list(filters = {}, page = 1, perPage = 0) {
  const db = getDb()
  const clauses = []
  const params = []
  if (filters.provider_id) { clauses.push('c.provider_id = ?'); params.push(Number(filters.provider_id)) }
  if (filters.model_name) { clauses.push('c.model_name = ?'); params.push(filters.model_name) }
  if (filters.user_id) { clauses.push('c.user_id = ?'); params.push(String(filters.user_id)) }
  const where = clauses.length > 0 ? 'WHERE ' + clauses.join(' AND ') : ''
  // ponytail: v0.2.14 LEFT JOIN via model_id (FK) — current_model_name reflects any rename.
  const baseSelect = `c.id, c.request_id, c.time, c.user_id, c.user_name, c.provider_id, c.provider_name, c.model_id, c.model_name, COALESCE(m.model_name, c.model_name) AS current_model_name, c.tokens_input, c.tokens_output, c.tokens_cached, c.duration_ms, c.input, c.output, c.error_code, c.error_message`
  const baseFrom = `communication_log c LEFT JOIN models m ON c.model_id = m.id`
  const mapRow = (r) => ({
    id: r.id, request_id: r.request_id, time: r.time, user_id: r.user_id, user_name: r.user_name,
    provider_id: r.provider_id, provider_name: r.provider_name,
    model_id: r.model_id, model_name: r.current_model_name || r.model_name,
    tokens_input: r.tokens_input, tokens_output: r.tokens_output, tokens_cached: r.tokens_cached,
    duration_ms: r.duration_ms,
    input: r.input, output: r.output,
    error: r.error_code ? { code: r.error_code, message: r.error_message } : undefined,
  })
  if (perPage > 0) {
    const offset = (page - 1) * perPage
    const total = (await db.query(`SELECT COUNT(*) as c FROM communication_log c ${where}`, params))[0]?.c || 0
    const rows = await db.query(
      `SELECT ${baseSelect} FROM ${baseFrom} ${where} ORDER BY c.id DESC LIMIT ? OFFSET ?`,
      [...params, perPage, offset]
    )
    return { total, rows: rows.map(mapRow) }
  }
  const rows = await db.query(
    `SELECT ${baseSelect} FROM ${baseFrom} ${where} ORDER BY c.id DESC`,
    params
  )
  return rows.map(mapRow)
}

export async function clear() {
  await getDb().run('DELETE FROM communication_log')
}

export async function renameUser(oldName, newName) {
  if (!oldName || oldName === newName) return
  await getDb().run('UPDATE communication_log SET user_name = ? WHERE user_name = ?', [newName, oldName])
}