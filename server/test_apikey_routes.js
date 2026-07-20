#!/usr/bin/env node
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import { initDb, getDb, closeDb } from './db/index.js'
import apikeyRoutes from './routes/apikey.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const dbPath = path.resolve(HERE, '../temp/test-apikey-routes.db')
fs.mkdirSync(path.dirname(dbPath), { recursive: true })
for (const suffix of ['', '-wal', '-shm']) fs.rmSync(dbPath + suffix, { force: true })

const app = Fastify()
try {
  await initDb({ type: 'sqlite3', path: dbPath })
  await app.register(apikeyRoutes)
  await getDb().run("INSERT INTO api_keys(key, name) VALUES ('skm-test', 'test-user')")

  let response = await app.inject({ method: 'GET', url: '/api/admin/api-keys' })
  assert.equal(response.statusCode, 200, response.body)
  assert.equal(response.json()[0].name, 'test-user')

  response = await app.inject({ method: 'POST', url: '/api/admin/api-keys', payload: { name: 'created-user' } })
  assert.equal(response.statusCode, 200, response.body)
  const created = response.json()

  response = await app.inject({ method: 'PUT', url: `/api/admin/api-keys/${created.id}`, payload: { name: 'updated-user' } })
  assert.equal(response.statusCode, 200, response.body)
  assert.equal(response.json().name, 'updated-user')

  console.log('✓ api-key admin routes work without legacy assigned_model column')
} finally {
  await app.close()
  await closeDb()
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(dbPath + suffix, { force: true })
}
