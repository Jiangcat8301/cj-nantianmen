import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { getConfDir, getConf, updateConf, randomSalt } from '../conf.js'
import { getDb, initDb, closeDb } from '../db/index.js'
import { rebuildModelMap } from '../services/modelMap.js'
import * as commlog from '../services/commlog.js'

const md5 = (s) => crypto.createHash('md5').update(s).digest('hex')

// ponytail: login is informational only — server already authenticates every request
// via header M. Login endpoint exists so clients can verify saved-md5 still works
// before they assume it's still good. (No token, no session file, no expiry.)
export default async function adminRoutes(fastify) {
  fastify.get('/api/admin/status', async () => {
    const conf = getConf()
    return {
      initialized: !!conf.initialized,
      host: conf.server_host,
      port: conf.server_port,
      database: conf.initialized ? conf.database : undefined,
    }
  })

  fastify.post('/api/admin/setup', async (req, reply) => {
    const conf = getConf()
    if (conf.initialized) return reply.code(409).send({ error: 'already initialized' })
    const { host, port, password_md5, database } = req.body || {}
    if (!host || !port || !password_md5) return reply.code(400).send({ error: 'host/port/password_md5 required' })
    if (!password_md5 || password_md5.length < 32) return reply.code(400).send({ error: 'password_md5 invalid' })
    const db = database || { type: 'sqlite3', path: './nantianmen.db' }
    if (db.type !== 'sqlite3' && db.type !== 'mysql') return reply.code(400).send({ error: 'unknown db type' })
    const salt = randomSalt()
    const hash = md5(password_md5 + salt)
    updateConf({
      initialized: true,
      server_host: host,
      server_port: Number(port),
      password: hash,
      salt,
      database: db,
    })
    await initDb(db)
    // Build model map after db is ready
    rebuildModelMap()
    return { ok: true, host, port, database: db }
  })

  fastify.post('/api/admin/login', async (req, reply) => {
    const conf = getConf()
    if (!conf.initialized) return reply.code(503).send({ error: 'not initialized' })
    const { password_md5 } = req.body || {}
    if (md5(password_md5 + conf.salt) !== conf.password) return reply.code(401).send({ error: 'invalid password' })
    return { ok: true }
  })

  fastify.post('/api/admin/password/change', async (req, reply) => {
    const conf = getConf()
    const { old_password_md5, new_password_md5 } = req.body || {}
    if (!old_password_md5 || !new_password_md5) return reply.code(400).send({ error: 'old/new required' })
    if (md5(old_password_md5 + conf.salt) !== conf.password) return reply.code(401).send({ error: 'old password incorrect' })
    if (new_password_md5.length !== 32) return reply.code(400).send({ error: 'new_password_md5 must be md5 hex' })
    const salt = randomSalt()
    const hash = md5(new_password_md5 + salt)
    updateConf({ password: hash, salt })
    return { ok: true }
  })

  fastify.post('/api/admin/database/configure', async (req, reply) => {
    const conf = getConf()
    if (!conf.initialized) return reply.code(503).send({ error: 'not initialized' })
    const { type, ...config } = req.body || {}
    if (type !== 'sqlite3' && type !== 'mysql') return reply.code(400).send({ error: 'unknown db type' })
    const newDb = { type, ...config }
    updateConf({ database: newDb })
    // ponytail: switch is deferred — server keeps running on old db.
    // Restart server to actually load the new db.
    return { ok: true, restart_required: true }
  })

  // ponytail: resolve user-supplied path against conf dir if relative,
  // so "./foo.db" means "next to nantianmen-conf.json".
  // Bare filenames without "./" are also treated as relative.
  function resolveDbPath(raw) {
    if (!raw) return raw
    if (path.isAbsolute(raw)) return raw
    return path.resolve(getConfDir(), raw)
  }

  fastify.post('/api/admin/database/move', async (req, reply) => {
    // ponytail: change DB file path and physically move the file.
    // Closes current DB, copies old file to new location, updates conf.
    // Caller triggers server restart to pick up the new DB.
    const conf = getConf()
    if (!conf.initialized) return reply.code(503).send({ error: 'not initialized' })
    if (conf.database?.type !== 'sqlite3') return reply.code(400).send({ error: 'only sqlite3 move supported' })
    const { path: rawPath } = req.body || {}
    if (!rawPath || typeof rawPath !== 'string') return reply.code(400).send({ error: 'path required' })

    const oldAbs = conf.database.path
    const newAbs = resolveDbPath(rawPath)
    if (newAbs === oldAbs) return { ok: true, changed: false, path: newAbs }

    // ponytail: sanity checks before we touch files
    if (fs.existsSync(newAbs)) return reply.code(409).send({ error: 'target file already exists' })
    const newDir = path.dirname(newAbs)
    try { fs.mkdirSync(newDir, { recursive: true }) } catch (e) {
      return reply.code(400).send({ error: `cannot create dir: ${e.message}` })
    }

    // ponytail: close current handle, move file + WAL/SHM sidecars.
    // Use copy+unlink (works across drives on Windows); rename would EXDEV cross-drive.
    try { await closeDb() } catch {}
    try {
      for (const suffix of ['', '-shm', '-wal']) {
        const src = oldAbs + suffix
        if (!fs.existsSync(src)) continue
        fs.copyFileSync(src, newAbs + suffix)
        fs.unlinkSync(src)
      }
    } catch (e) {
      return reply.code(500).send({ error: `move failed: ${e.message}` })
    }

    updateConf({ database: { ...conf.database, path: newAbs } })
    return { ok: true, changed: true, old_path: oldAbs, path: newAbs, restart_required: true }
  })

  fastify.get('/api/admin/settings', async () => {
    const conf = getConf()
    return {
      host: conf.server_host,
      port: conf.server_port,
      database: conf.database,
    }
  })

  fastify.put('/api/admin/settings', async (req, reply) => {
    const conf = getConf()
    const { host, port } = req.body || {}
    if (!host || !port) return reply.code(400).send({ error: 'host/port required' })
    const portChanged = Number(port) !== conf.server_port
    updateConf({ server_host: host, server_port: Number(port) })
    return { ok: true, restart_required: portChanged }
  })

  fastify.post('/api/admin/server/shutdown', async (req, reply) => {
    reply.send({ ok: true })
    setTimeout(() => process.exit(0), 100)
  })

  fastify.post('/api/admin/server/restart', async (req, reply) => {
    reply.send({ ok: true })
    // parent (CLI/desktop) should respawn from outside; server just exits
    setTimeout(() => process.exit(0), 100)
  })

  // ponytail: UI filter state persistence — save per-page filters so they survive navigation
  fastify.get('/api/admin/ui-filters', async () => {
    return getConf().ui_filters || {}
  })
  fastify.put('/api/admin/ui-filters', async (req) => {
    updateConf({ ui_filters: req.body || {} })
    return getConf().ui_filters
  })

  // ponytail: communication log — GET with filters, DELETE to clear, PUT to toggle
  fastify.get('/api/admin/communication-log', async (req) => {
    return commlog.list(req.query || {})
  })

  fastify.delete('/api/admin/communication-log', async () => {
    commlog.clear()
    return { ok: true }
  })

  fastify.get('/api/admin/communication-log/config', async () => {
    return { log_enabled: getConf().log_enabled || false }
  })

  fastify.put('/api/admin/communication-log/config', async (req) => {
    const { log_enabled } = req.body || {}
    updateConf({ log_enabled: !!log_enabled })
    return { log_enabled: getConf().log_enabled }
  })
}
