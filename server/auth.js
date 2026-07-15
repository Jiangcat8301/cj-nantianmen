// admin auth: header M = md5(RAWPASSWORD); server stores md5(M + salt).
// All /api/admin/* routes except setup/login/status go through this.
import crypto from 'node:crypto'
import { getConf } from './conf.js'

const WHITELIST = new Set([
  '/api/admin/status',
  '/api/admin/setup',
  '/api/admin/login',
])

function md5(s) { return crypto.createHash('md5').update(s).digest('hex') }

// ponytail: local mode - skip admin auth when Electron launches server directly.
const LOCAL_MODE = process.env.NANTIANMEN_LOCAL_MODE === '1'

export async function adminAuth(req, reply) {
  if (!req.url.startsWith('/api/admin/')) return
  if (LOCAL_MODE) return
  // Strip query string for whitelist check
  const path = req.url.split('?')[0]
  if (WHITELIST.has(path)) return
  const conf = getConf()
  // Before initialized, no auth possible
  if (!conf.initialized) return reply.code(503).send({ error: 'not initialized' })
  const auth = req.headers['authorization'] || ''
  const m = auth.replace(/^Bearer\s+/i, '')
  if (!m) return reply.code(401).send({ error: 'missing Authorization header' })
  const expected = md5(m + conf.salt)
  if (expected !== conf.password) return reply.code(401).send({ error: 'invalid password' })
}
