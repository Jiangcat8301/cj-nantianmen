#!/usr/bin/env node
// Ponytail: end-to-end smoke test for v0.2 setup → restart → login → health.
// Validates: password hashing, conf.json persistence, sqlite3 init, auth gate.
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const PORT = 38271
const HOST = '127.0.0.1'
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex')

const ROOT = process.cwd()
const CONF_FILE = path.join(ROOT, 'nantianmen-conf.json')
const DB_FILE = path.join(ROOT, 'nantianmen.db')

// Cleanup
for (const f of [CONF_FILE, DB_FILE, DB_FILE + '-wal', DB_FILE + '-shm', 'server.log', 'test.log']) {
  try { fs.rmSync(f, { force: true }) } catch {}
}

function startServer() {
  return spawn('node', ['index.js'], { cwd: ROOT, stdio: 'pipe' })
}

function waitForHealth(timeoutMs = 5000) {
  const t0 = Date.now()
  return new Promise((resolve, reject) => {
    const tryOnce = async () => {
      try {
        const r = await fetch(`http://${HOST}:${PORT}/v1/health`)
        if (r.ok) return resolve(await r.json())
      } catch {}
      if (Date.now() - t0 > timeoutMs) return reject(new Error('server did not become healthy'))
      setTimeout(tryOnce, 100)
    }
    tryOnce()
  })
}

function fail(msg) { console.error(`✗ ${msg}`); process.exit(1) }
function pass(msg) { console.log(`✓ ${msg}`) }

async function post(url, body, headers = {}) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
  const text = await r.text()
  let data
  try { data = JSON.parse(text) } catch { data = text }
  return { status: r.status, data }
}

async function get(url, headers = {}) {
  const r = await fetch(url, { headers })
  const text = await r.text()
  let data
  try { data = JSON.parse(text) } catch { data = text }
  return { status: r.status, data }
}

async function main() {
  let server

  // 1) fresh start
  console.log('--- 1) fresh server start ---')
  server = startServer()
  await waitForHealth()
  pass('health 200')

  // 2) status reports not initialized
  const s1 = await get(`http://${HOST}:${PORT}/api/admin/status`)
  if (!s1.data.initialized) pass('status.initialized=false')
  else fail(`expected initialized=false, got ${JSON.stringify(s1.data)}`)

  // 3) wrong hash doesn't pass setup (it should succeed; password_md5 length check)
  const r3 = await post(`http://${HOST}:${PORT}/api/admin/setup`, { host: HOST, port: PORT, password_md5: 'short' })
  if (r3.status === 400) pass('setup rejects short hash (400)')
  else fail(`expected 400, got ${r3.status}: ${JSON.stringify(r3.data)}`)

  // 4) valid setup
  const raw = 'a-strong-password-not-revealed'
  const m = md5(raw)
  const r4 = await post(`http://${HOST}:${PORT}/api/admin/setup`, {
    host: HOST, port: PORT, password_md5: m,
    database: { type: 'sqlite3', path: DB_FILE },
  })
  if (r4.status === 200 && r4.data.ok) pass('setup 200')
  else fail(`setup failed: ${r4.status} ${JSON.stringify(r4.data)}`)

  // 5) conf.json persisted
  const conf = JSON.parse(fs.readFileSync(CONF_FILE, 'utf8'))
  if (conf.initialized && conf.salt && conf.password) pass(`conf.json persisted (salt=${conf.salt}, port=${conf.server_port})`)
  else fail(`conf missing fields: ${JSON.stringify(conf)}`)

  // 6) db created and tables exist
  if (fs.existsSync(DB_FILE)) pass('nantianmen.db created')
  else fail('db missing')

  const Database = (await import('better-sqlite3')).default
  const tmpdb = new Database(DB_FILE, { readonly: true })
  const tables = tmpdb.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r => r.name)
  tmpdb.close()
  const expected = ['api_keys', 'models', 'providers', 'usage_stats'].sort()
  const got = tables.filter(t => expected.includes(t)).sort()
  if (JSON.stringify(got) === JSON.stringify(expected)) pass(`tables: ${got.join(', ')}`)
  else fail(`expected ${expected}, got ${tables}`)

  // 7) setup again returns 409 (already initialized)
  const r7 = await post(`http://${HOST}:${PORT}/api/admin/setup`, { host: HOST, port: PORT, password_md5: m })
  if (r7.status === 409) pass('double setup rejected (409)')
  else fail(`expected 409, got ${r7.status}: ${JSON.stringify(r7.data)}`)

  // 8) login with correct md5 succeeds
  const r8 = await post(`http://${HOST}:${PORT}/api/admin/login`, { password_md5: m })
  if (r8.status === 200 && r8.data.ok) pass('login 200')
  else fail(`login failed: ${r8.status} ${JSON.stringify(r8.data)}`)

  // 9) login with wrong md5 returns 401
  const r9 = await post(`http://${HOST}:${PORT}/api/admin/login`, { password_md5: '0'.repeat(32) })
  if (r9.status === 401) pass('wrong hash login rejected (401)')
  else fail(`expected 401, got ${r9.status}: ${JSON.stringify(r9.data)}`)

  // 10) protected endpoint /api/admin/settings requires Authorization
  const r10 = await get(`http://${HOST}:${PORT}/api/admin/settings`)
  if (r10.status === 401) pass('protected endpoint without auth => 401')
  else fail(`expected 401, got ${r10.status}: ${JSON.stringify(r10.data)}`)

  // 11) protected endpoint with correct hash
  const r11 = await get(`http://${HOST}:${PORT}/api/admin/settings`, { Authorization: `Bearer ${m}` })
  if (r11.status === 200 && r11.data.host) pass(`protected endpoint with auth => 200 (host=${r11.data.host})`)
  else fail(`expected 200, got ${r11.status}: ${JSON.stringify(r11.data)}`)

  // 12) health still public
  const r12 = await get(`http://${HOST}:${PORT}/v1/health`)
  if (r12.status === 200) pass('health remains public after init')
  else fail(`expected 200, got ${r12.status}`)

  // 13) shutdown
  const r13 = await post(`http://${HOST}:${PORT}/api/admin/server/shutdown`, {}, { Authorization: `Bearer ${m}` })
  if (r13.status === 200) pass('shutdown returns 200')
  else fail(`shutdown: ${r13.status}`)

  // wait for process to die
  await new Promise(r => setTimeout(r, 500))

  // 14) restart, login still works (auth survives restart)
  console.log('--- 14) restart ---')
  server = startServer()
  await waitForHealth()
  pass('server back up')

  const r14 = await post(`http://${HOST}:${PORT}/api/admin/login`, { password_md5: m })
  if (r14.status === 200 && r14.data.ok) pass('login after restart still works (auth persisted to conf.json)')
  else fail(`post-restart login: ${r14.status}: ${JSON.stringify(r14.data)}`)

  // 15) password change: old md5 with old salt should fail; new md5 with new salt should work
  const rOld = await post(`http://${HOST}:${PORT}/api/admin/login`, { password_md5: '0'.repeat(32) })
  if (rOld.status === 401) pass('wrong password 401 before change')
  else fail(`pre-change wrong password: ${rOld.status}`)

  const newRaw = 'an-even-stronger-password-changed'
  const mNew = md5(newRaw)
  const rChange = await post(`http://${HOST}:${PORT}/api/admin/password/change`, {
    old_password_md5: m, new_password_md5: mNew,
  }, { Authorization: `Bearer ${m}` })
  if (rChange.status === 200 && rChange.data.ok) pass('password change 200')
  else fail(`change failed: ${rChange.status}: ${JSON.stringify(rChange.data)}`)

  // after change, old md5 should NOT work (server has new salt now)
  const rPostOld = await post(`http://${HOST}:${PORT}/api/admin/login`, { password_md5: m })
  if (rPostOld.status === 401) pass('old md5 rejected after password change (salt rotated)')
  else fail(`post-change old hash should be 401: ${rPostOld.status}`)

  // new md5 should work
  const rPostNew = await get(`http://${HOST}:${PORT}/api/admin/settings`, { Authorization: `Bearer ${mNew}` })
  if (rPostNew.status === 200) pass('new md5 works after change')
  else fail(`new md5 should be 200: ${rPostNew.status}`)

  // 16) cleanup
  await post(`http://${HOST}:${PORT}/api/admin/server/shutdown`, {}, { Authorization: `Bearer ${mNew}` })
  await new Promise(r => setTimeout(r, 300))
  if (server.exitCode !== null || server.killed) pass('shutdown clean')
  // don't fail if process already exited; main goal is test results

  console.log('\nALL TESTS PASSED')
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
