import Fastify from 'fastify'
import { existsSync as fsSync } from 'node:fs'
import { setPaths, loadConf, getConf, updateConf } from './conf.js'
import { initDb, getDb } from './db/index.js'
import { adminAuth } from './auth.js'
import { rebuildModelMap } from './services/modelMap.js'
import * as stats from './services/stats.js'
import * as commlog from './services/commlog.js'
import adminRoutes from './routes/admin.js'
import llmRoutes from './routes/llm.js'
import apikeyRoutes from './routes/apikey.js'
import providerRoutes from './routes/provider.js'

// ponytail: parse -c / -D / --config-path / --database-path before any other init runs.
// Desktop forks with explicit values; standalone server inherits defaults from binary dir.
function argvValue(...names) {
  const a = process.argv
  for (let i = 0; i < a.length; i++) {
    for (const n of names) {
      if (a[i] === n && i + 1 < a.length) return a[i + 1]
      if (a[i].startsWith(n + '=')) return a[i].slice(n.length + 1)
    }
  }
  return null
}
setPaths({
  confPath: argvValue('-c', '--config-path'),
  dbPath: argvValue('-D', '--database-path'),
})

const fastify = Fastify({ logger: { level: 'info' } })

// Load conf first; auto-init if file missing.
const conf = loadConf()

// Start db if already initialized; otherwise only /api/admin/status works.
let dbReady = false
async function ensureDb() {
  if (dbReady) return
  // ponytail: first-run safety net. If conf exists but marked uninitialized (legacy conf)
  // and a DB file exists at the configured path, treat as initialized.
  if (!conf.initialized && conf.database?.path && fsSync.existsSync(conf.database.path)) {
    conf.initialized = true
    updateConf({ initialized: true })
  }
  if (!conf.initialized) return
  await initDb(conf.database)
  dbReady = true
  await rebuildModelMap()
  stats.startFlushTask()
  commlog.initBuffer()
}
// ponytail: imports kept at the top of the file

fastify.addHook('onRequest', async (req, reply) => {
  // ponytail: only `/v1/*` and `/api/admin/*` are our routes; everything else 404.
  if (!req.url.startsWith('/v1/') && !req.url.startsWith('/api/admin/')) {
    return reply.code(404).send({ error: 'not found' })
  }
  await adminAuth(req, reply)
})

await fastify.register(adminRoutes)
await fastify.register(llmRoutes)
await fastify.register(apikeyRoutes)
await fastify.register(providerRoutes)

fastify.addHook('onReady', async () => {
  await ensureDb()
})

const host = conf.initialized ? conf.server_host : '127.0.0.1'
const port = conf.initialized ? conf.server_port : 38271

try {
  await fastify.listen({ host, port })
  fastify.log.info(`Nantianmen v0.2.4 on http://${host}:${port} (init=${conf.initialized})`)
  console.error('[MARKER] listen complete')
} catch (e) {
  fastify.log.error(e)
  process.exit(1)
}

// ponytail: don't keep stdin open — Hermes/CI wrappers close stdin which would
// otherwise SIGPIPE the server. Server is a daemon, doesn't read stdin.
try { process.stdin.unref() } catch {}
