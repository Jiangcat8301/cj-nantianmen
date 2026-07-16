// ponytail: communication log stored in SQLite. On first access, migrate any
// existing JSON log file into the DB table, then delete the file.
// v0.2.7: buffered writes — append() queues to memory, flush() bulk-inserts every 10s.
// Rotation support: when log_rotation_enabled, trim to log_rotation_max on flush.
import fs from 'node:fs'
import path from 'node:path'
import { getConfDir, getConf } from '../conf.js'
import { getDb } from '../db/index.js'

const ROTATION_DEFAULT_MAX = 1000
const LEGACY_FILE = path.join(getConfDir(), 'communication_log.json')

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

async function flushBuffer() {
  if (_buf.length === 0) return
  const batch = _buf
  _buf = []
  try {
    const db = getDb()
    // ponytail: batch insert — one INSERT per entry, wrapped in a transaction
    for (const entry of batch) {
      await db.run(
        `INSERT INTO communication_log (request_id, time, user_id, user_name, provider_id, provider_name, model_name, tokens_input, tokens_output, tokens_cached, input, output, error_code, error_message)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [entry.request_id || '', entry.time || '', entry.user_id || '', entry.user_name || '', entry.provider_id || 0, entry.provider_name || '', entry.model_name || '',
         entry.tokens_input || 0, entry.tokens_output || 0, entry.tokens_cached || 0,
         entry.input || '', entry.output || '', entry.error?.code || null, entry.error?.message || null]
      )
    }
    // ponytail: rotation — trim oldest rows beyond max
    if (rotationEnabled()) {
      const max = rotationMax()
      const count = (await db.query(`SELECT COUNT(*) as c FROM communication_log`))[0]?.c || 0
      if (count > max) {
        await db.run(`DELETE FROM communication_log WHERE id IN (SELECT id FROM communication_log ORDER BY created_at ASC LIMIT ?)`, [count - max])
      }
    }
  } catch (e) {
    console.error('[commlog] flush failed:', e.message)
  }
}

export function initBuffer() {
  if (_flushTimer) return
  _flushTimer = setInterval(flushBuffer, FLUSH_INTERVAL_MS)
  // ponytail: final flush on process exit
  process.on('beforeExit', () => flushBuffer())
  process.on('exit', () => {
    // sync flush via db directly (getDb is sqlite sync)
    try { flushBuffer() } catch {}
  })
  console.log(`[commlog] buffer init, flush every ${FLUSH_INTERVAL_MS / 1000}s`)
}

// ponytail: one-time migrate legacy JSON log → DB.
// Runs on first append or list call after upgrade from v0.2.6.
let _migrated = false
async function migrateLegacy() {
  if (_migrated) return
  _migrated = true
  try {
    if (!fs.existsSync(LEGACY_FILE)) return
    const raw = fs.readFileSync(LEGACY_FILE, 'utf-8')
    const entries = JSON.parse(raw)
    if (!Array.isArray(entries) || entries.length === 0) {
      fs.unlinkSync(LEGACY_FILE)
      return
    }
    const db = getDb()
    for (const e of entries) {
      await db.run(
        `INSERT INTO communication_log (request_id, time, user_id, user_name, provider_id, provider_name, model_name, tokens_input, tokens_output, tokens_cached, input, output, error_code, error_message)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [e.request_id || '', e.time || '', e.user_id || '', e.user_name || '', e.provider_id || 0, e.provider_name || '', e.model_name || '',
         e.tokens_input || 0, e.tokens_output || 0, e.tokens_cached || 0,
         e.input || '', e.output || '', e.error?.code || null, e.error?.message || null]
      )
    }
    fs.unlinkSync(LEGACY_FILE)
    console.log(`[commlog] migrated ${entries.length} entries from legacy JSON → DB`)
  } catch (e) {
    console.error('[commlog] legacy migration failed:', e.message)
  }
}

export async function append(entry) {
  if (!getConf().log_enabled) return
  await migrateLegacy()
  _buf.push(entry)
}

export async function list(filters = {}, page = 1, perPage = 0) {
  await migrateLegacy()
  const db = getDb()
  const clauses = []
  const params = []
  if (filters.provider_id) { clauses.push('provider_id = ?'); params.push(Number(filters.provider_id)) }
  if (filters.model_name) { clauses.push('model_name = ?'); params.push(filters.model_name) }
  if (filters.user_id) { clauses.push('user_id = ?'); params.push(String(filters.user_id)) }
  const where = clauses.length > 0 ? 'WHERE ' + clauses.join(' AND ') : ''
  if (perPage > 0) {
    const offset = (page - 1) * perPage
    const total = (await db.query(`SELECT COUNT(*) as c FROM communication_log ${where}`, params))[0]?.c || 0
    const rows = await db.query(
      `SELECT id, request_id, time, user_id, user_name, provider_id, provider_name, model_name, tokens_input, tokens_output, tokens_cached, input, output, error_code, error_message
       FROM communication_log ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, perPage, offset]
    )
    return { total, rows: rows.map(r => ({
      request_id: r.request_id, time: r.time, user_id: r.user_id, user_name: r.user_name,
      provider_id: r.provider_id, provider_name: r.provider_name, model_name: r.model_name,
      tokens_input: r.tokens_input, tokens_output: r.tokens_output, tokens_cached: r.tokens_cached,
      input: r.input, output: r.output,
      error: r.error_code ? { code: r.error_code, message: r.error_message } : undefined,
    })) }
  }
  const rows = await db.query(
    `SELECT id, request_id, time, user_id, user_name, provider_id, provider_name, model_name, tokens_input, tokens_output, tokens_cached, input, output, error_code, error_message
     FROM communication_log ${where} ORDER BY created_at DESC`,
    params
  )
  return rows.map(r => ({
    request_id: r.request_id, time: r.time, user_id: r.user_id, user_name: r.user_name,
    provider_id: r.provider_id, provider_name: r.provider_name, model_name: r.model_name,
    tokens_input: r.tokens_input, tokens_output: r.tokens_output, tokens_cached: r.tokens_cached,
    input: r.input, output: r.output,
    error: r.error_code ? { code: r.error_code, message: r.error_message } : undefined,
  }))
}

export async function clear() {
  await migrateLegacy()
  await getDb().run('DELETE FROM communication_log')
}

export async function renameUser(oldName, newName) {
  if (!oldName || oldName === newName) return
  await migrateLegacy()
  await getDb().run('UPDATE communication_log SET user_name = ? WHERE user_name = ?', [newName, oldName])
}
