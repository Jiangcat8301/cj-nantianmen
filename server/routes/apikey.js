import crypto from 'node:crypto'
import { getDb } from '../db/index.js'

function genKey() {
  // skm- + 40 hex chars
  return 'skm-' + crypto.randomBytes(20).toString('hex')
}

export default async function apikeyRoutes(fastify) {
  fastify.get('/api/admin/api-keys', async () => getDb().query('SELECT id, key, name, note, created_at, last_used_at FROM api_keys ORDER BY id'))

  fastify.post('/api/admin/api-keys', async (req) => {
    const { name = '', note = '' } = req.body || {}
    const key = genKey()
    const r = await getDb().run('INSERT INTO api_keys(key, name, note) VALUES (?,?,?)', [key, name, note])
    const rows = await getDb().query('SELECT id, key, name, note, created_at FROM api_keys WHERE id=?', [r.lastInsertRowid])
    return rows[0]
  })

  fastify.put('/api/admin/api-keys/:id', async (req, reply) => {
    const { name, note } = req.body || {}
    await getDb().run('UPDATE api_keys SET name=COALESCE(?, name), note=COALESCE(?, note) WHERE id=?', [name, note, req.params.id])
    const rows = await getDb().query('SELECT * FROM api_keys WHERE id=?', [req.params.id])
    return rows[0] || reply.code(404).send({ error: 'not found' })
  })

  fastify.delete('/api/admin/api-keys/:id', async (req, reply) => {
    const r = await getDb().run('DELETE FROM api_keys WHERE id=?', [req.params.id])
    return r.changes ? { ok: true } : reply.code(404).send({ error: 'not found' })
  })
}
