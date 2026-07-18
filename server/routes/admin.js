import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { getConfDir, getConf, updateConf, randomSalt } from '../conf.js'
import { getDb, initDb, closeDb } from '../db/index.js'
import { rebuildModelMap } from '../services/modelMap.js'
import { resetDispatcherCache } from '../services/proxyDispatcher.js'
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
      proxy: conf.proxy || 'system',
      proxy_url: conf.proxy_url || '',
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

  // ponytail: proxy mode for upstream LLM calls. system/direct/custom.
  fastify.get('/api/admin/proxy', async () => {
    const conf = getConf()
    return { mode: conf.proxy || 'system', url: conf.proxy_url || '' }
  })

  fastify.put('/api/admin/proxy', async (req, reply) => {
    const { mode, url } = req.body || {}
    if (!['system', 'direct', 'custom'].includes(mode)) {
      return reply.code(400).send({ error: 'mode must be system|direct|custom' })
    }
    if (mode === 'custom' && (!url || !/^(https?|socks5?):\/\//.test(url))) {
      return reply.code(400).send({ error: 'custom mode requires a proxy URL like http://host:port or socks5://host:port' })
    }
    updateConf({ proxy: mode, proxy_url: mode === 'custom' ? url : '' })
    resetDispatcherCache()
    return { ok: true, mode, url: mode === 'custom' ? url : '' }
  })

  fastify.post('/api/admin/server/shutdown', async (req, reply) => {
    reply.send({ ok: true })
    // ponytail: flush buffered stats + logs before exit
    await stats.flush()
    await commlog.flushBuffer()
    setTimeout(() => process.exit(0), 100)
  })

  fastify.post('/api/admin/server/restart', async (req, reply) => {
    reply.send({ ok: true })
    await stats.flush()
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

  fastify.get('/api/admin/database/info', async () => {
    const conf = getConf()
    const db = getDb()
    let size = 0
    if (conf.database?.type === 'sqlite3') {
      const stat = fs.statSync(conf.database.path)
      size = stat.size
    }
    const count = (await db.query('SELECT COUNT(*) as c FROM communication_log'))[0]?.c || 0
    return { type: conf.database?.type || 'unknown', path: conf.database?.path || '', size, log_count: count }
  })
  fastify.get('/api/admin/communication-log', async (req) => {
    const query = req.query || {}
    const page = parseInt(query.page) || null
    const perPage = page ? (parseInt(query.per_page) || 20) : 0
    return await commlog.list(query, page || 1, perPage)
  })

  fastify.delete('/api/admin/communication-log', async () => {
    await commlog.clear()
    return { ok: true }
  })

  fastify.get('/api/admin/communication-log/config', async () => {
    const c = getConf()
    return {
      log_enabled: c.log_enabled || false,
      log_rotation_enabled: c.log_rotation_enabled || false,
      log_rotation_max: c.log_rotation_max || 500,
    }
  })

  fastify.put('/api/admin/communication-log/config', async (req) => {
    const patch = {}
    if (req.body.log_enabled !== undefined) patch.log_enabled = !!req.body.log_enabled
    if (req.body.log_rotation_enabled !== undefined) patch.log_rotation_enabled = !!req.body.log_rotation_enabled
    if (req.body.log_rotation_max !== undefined) patch.log_rotation_max = parseInt(req.body.log_rotation_max) || 500
    if (Object.keys(patch).length > 0) updateConf(patch)
    // ponytail: lowering max below current count must trim NOW, not wait for next flush (#6).
    // Trigger only when rotation is enabled and we have a numeric max.
    const c = getConf()
    if (patch.log_rotation_enabled !== false && c.log_rotation_max && c.log_rotation_max > 0) {
      try { await commlog.trimToMax(parseInt(c.log_rotation_max)) } catch (e) {
        req.log.warn('[admin] commlog trim failed: ' + e.message)
      }
    }
    const c2 = getConf()
    return {
      log_enabled: c2.log_enabled || false,
      log_rotation_enabled: c2.log_rotation_enabled || false,
      log_rotation_max: c2.log_rotation_max || 500,
    }
  })
}
