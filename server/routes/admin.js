import crypto from 'node:crypto'
import { getConf, updateConf, randomSalt } from '../conf.js'
import { getDb, initDb, closeDb } from '../db/index.js'
import { rebuildModelMap } from '../services/modelMap.js'

const md5 = (s) => crypto.createHash('md5').update(s).digest('hex')

// ponytail: login is informational only — server already authenticates every request
// via header M. Login endpoint exists so clients can verify saved-md5 still works
// before they assume it's still good. (No token, no session file, no expiry.)
export default async function adminRoutes(fastify) {
  fastify.get('/api/admin/status', async () => {
    const conf = getConf()
    return { initialized: !!conf.initialized, host: conf.server_host, port: conf.server_port }
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
}
