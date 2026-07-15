#!/usr/bin/env node
// nantianmen CLI v0.2. stdlib only.
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { prompt, askSecret } from './prompt.js'

const md5 = (s) => crypto.createHash('md5').update(s).digest('hex')

const CFG_DIR = path.join(os.homedir(), '.nantianmen')
const CFG_FILE = path.join(CFG_DIR, 'config.json')

const loadCfg = () => fs.existsSync(CFG_FILE) ? JSON.parse(fs.readFileSync(CFG_FILE, 'utf8')) : {}
const saveCfg = (c) => {
  fs.mkdirSync(CFG_DIR, { recursive: true })
  fs.writeFileSync(CFG_FILE, JSON.stringify(c, null, 2))
  try { fs.chmodSync(CFG_FILE, 0o600) } catch {}
}

function flagValue(argv, ...names) {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    for (const n of names) {
      if (a === n && i + 1 < argv.length) return argv[i + 1]
      if (a.startsWith(n + '=')) return a.slice(n.length + 1)
    }
  }
  return null
}

export function resolveArgs() {
  const cfg = loadCfg()
  const host = flagValue(process.argv, '-H', '--host') || process.env.NANTIANMEN_SERVER_HOST || cfg.host || '127.0.0.1'
  const port = Number(flagValue(process.argv, '--port') || process.env.NANTIANMEN_SERVER_PORT || cfg.port || 38271)
  const rawPwd = flagValue(process.argv, '-P', '--password') || process.env.NANTIANMEN_ADMIN_PASSWORD || cfg.password_md5
  let password_md5 = null
  // cfg.password_md5 is already md5; env/flag are RAW password.
  if (rawPwd) {
    if (/^[a-f0-9]{32}$/.test(rawPwd)) password_md5 = rawPwd
    else if (rawPwd === cfg.password_md5) password_md5 = rawPwd
    else password_md5 = md5(rawPwd)
  }
  return { host, port, password_md5 }
}

export async function call(method, path, body, { headers = {}, noAuth = false } = {}) {
  const args = resolveArgs()
  const url = `http://${args.host}:${args.port}` + path
  const h = { 'Content-Type': 'application/json', ...headers }
  if (!noAuth && args.password_md5 && !h.Authorization) h.Authorization = `Bearer ${args.password_md5}`
  const resp = await fetch(url, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined })
  const text = await resp.text()
  let data
  try { data = JSON.parse(text) } catch { data = text }
  // ponytail: exit non-zero on auth errors so shell scripts can detect failure.
  // Login/setup intentionally call with noAuth so this only applies to protected paths.
  if (!noAuth && resp.status >= 400) {
    console.error(`✗ ${method} ${path} -> ${resp.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`)
    process.exit(1)
  }
  return { status: resp.status, data }
}

// --- commands ---
async function cmdSetup() {
  console.log('=== Nantianmen setup ===')
  const cfg = loadCfg()
  const host = await prompt('Server host [127.0.0.1]: ') || cfg.host || '127.0.0.1'
  const port = Number((await prompt('Server port [38271]: ') || cfg.port || '38271'))

  console.log('\nDatabase:')
  console.log('  1) SQLite3 (default)')
  console.log('  2) MySQL')
  const dbChoice = await prompt('Select [1]: ') || '1'
  let database
  if (dbChoice === '2') {
    const mHost = await prompt('MySQL host: ')
    const mPort = Number((await prompt('MySQL port [3306]: ') || '3306'))
    const mUser = await prompt('MySQL username: ')
    const mPass = await askSecret('MySQL password: ')
    database = { type: 'mysql', host: mHost, port: mPort, username: mUser, password: mPass }
  } else {
    const sqlitePath = await prompt('SQLite file path [./nantianmen.db]: ') || './nantianmen.db'
    database = { type: 'sqlite3', path: sqlitePath }
  }

  console.log('\nAdmin password (min 6 chars):')
  const pwd1 = await askSecret('  New password: ')
  const pwd2 = await askSecret('  Confirm: ')
  if (pwd1 !== pwd2) { console.error('passwords do not match'); process.exit(1) }
  if (pwd1.length < 6) { console.error('password too short'); process.exit(1) }

  const r = await call('POST', '/api/admin/setup', { host, port, password_md5: md5(pwd1), database }, { noAuth: true })
  if (r.status !== 200) { console.error('setup failed:', r.status, JSON.stringify(r.data)); process.exit(1) }
  console.log('✓ server initialized at', `${host}:${port}`)
  saveCfg({ host, port, password_md5: md5(pwd1), database })
  console.log(`✓ saved config to ${CFG_FILE}`)
}

async function cmdHealth() {
  const r = await call('GET', '/v1/health', undefined, { noAuth: true })
  const text = r.status === 200 ? `✓ ${JSON.stringify(r.data, null, 2)}` : `✗ ${r.status} ${JSON.stringify(r.data)}`
  console.log(text)
  process.exit(r.status === 200 ? 0 : 1)
}

async function cmdStatus() {
  const r = await call('GET', '/api/admin/status', undefined, { noAuth: true })
  console.log(JSON.stringify(r.data))
}

async function cmdLogin() {
  const pwd = await askSecret('Admin password: ')
  const m = md5(pwd)
  const r = await call('POST', '/api/admin/login', { password_md5: m }, { noAuth: true })
  if (r.status !== 200) { console.error('login failed:', r.status, JSON.stringify(r.data)); process.exit(1) }
  const cfg = loadCfg()
  const args = resolveArgs()
  saveCfg({ ...cfg, host: args.host, port: args.port, password_md5: m })
  console.log(`✓ saved to ${CFG_FILE}`)
}

async function cmdDatabase() {
  console.log('Configure database backend:')
  console.log('  1) SQLite3')
  console.log('  2) MySQL')
  const c = await prompt('Select: ')
  let database
  if (c === '2') {
    const h = await prompt('MySQL host: ')
    const p = Number((await prompt('MySQL port [3306]: ') || '3306'))
    const u = await prompt('MySQL username: ')
    const pw = await askSecret('MySQL password: ')
    database = { type: 'mysql', host: h, port: p, username: u, password: pw }
  } else if (c === '1') {
    const pt = await prompt('SQLite file path [./nantianmen.db]: ') || './nantianmen.db'
    database = { type: 'sqlite3', path: pt }
  } else { console.error('invalid choice'); process.exit(1) }
  const r = await call('POST', '/api/admin/database/configure', database)
  if (r.status !== 200) { console.error('failed:', r.status, JSON.stringify(r.data)); process.exit(1) }
  console.log('✓ database configured; restart server to apply')
}

async function cmdSettings() {
  const r = await call('GET', '/api/admin/settings')
  console.log(JSON.stringify(r.data, null, 2))
}

async function cmdPasswordChange() {
  const oldPwd = await askSecret('Current password: ')
  const new1 = await askSecret('New password: ')
  const new2 = await askSecret('Confirm new: ')
  if (new1 !== new2) { console.error('mismatch'); process.exit(1) }
  if (new1.length < 6) { console.error('too short'); process.exit(1) }
  const r = await call('POST', '/api/admin/password/change', {
    old_password_md5: md5(oldPwd),
    new_password_md5: md5(new1),
  })
  if (r.status !== 200) { console.error('failed:', r.status, JSON.stringify(r.data)); process.exit(1) }
  const cfg = loadCfg()
  delete cfg.password_md5
  saveCfg(cfg)
  console.log('✓ password changed; salt rotated. Run `nantianmen login` to save new hash.')
}

async function cmdShutdown() { console.log(JSON.stringify((await call('POST', '/api/admin/server/shutdown', {})).data)) }
async function cmdRestart() { console.log(JSON.stringify((await call('POST', '/api/admin/server/restart', {})).data)) }

async function cmdProviders() {
  const args = process.argv.slice(3)
  const sub = args[0]
  if (sub === 'ls' || !sub) {
    const r = await call('GET', '/api/admin/providers')
    if (r.status !== 200) { console.error('failed:', r.status, JSON.stringify(r.data)); process.exit(1) }
    for (const p of r.data) console.log(`${p.id}\t${p.name}\t${p.protocol}\t${p.api_key}\t${p.base_url}`)
    return
  }
  if (sub === 'add') {
    const name = await prompt('Provider name (no spaces/underscores): ')
    const protocol = (await prompt('Protocol (openai|anthropic): '))
    const base_url = await prompt('Base URL: ')
    const api_key = await askSecret('API key: ')
    const r = await call('POST', '/api/admin/providers', { name, protocol, base_url, api_key })
    console.log(r.status === 200 ? `✓ added id=${r.data.id}` : `✗ ${r.status} ${JSON.stringify(r.data)}`)
    process.exit(r.status === 200 ? 0 : 1)
  }
  if (sub === 'rm') {
    const id = args[1] || await prompt('Provider id: ')
    const r = await call('DELETE', `/api/admin/providers/${id}`)
    console.log(r.status === 200 ? '✓ removed' : `✗ ${r.status} ${JSON.stringify(r.data)}`)
    process.exit(r.status === 200 ? 0 : 1)
  }
  console.error('usage: nantianmen provider [ls|add|rm]')
}

async function cmdApikeys() {
  const args = process.argv.slice(3)
  const sub = args[0]
  if (sub === 'ls' || !sub) {
    const r = await call('GET', '/api/admin/api-keys')
    if (r.status !== 200) { console.error('failed:', r.status, JSON.stringify(r.data)); process.exit(1) }
    for (const k of r.data) console.log(`${k.id}\t${k.key}\t${k.name}\t${k.note}\t${k.last_used_at || '-'}`)
    return
  }
  if (sub === 'new') {
    const name = await prompt('Name: ')
    const note = await prompt('Note: ')
    const r = await call('POST', '/api/admin/api-keys', { name, note })
    if (r.status !== 200) { console.error('failed:', r.status, JSON.stringify(r.data)); process.exit(1) }
    console.log(`✓ key created: ${r.data.key}`)
    console.log('⚠ save it now; the plaintext is not shown again')
    return
  }
  if (sub === 'rm') {
    const id = args[1] || await prompt('Key id: ')
    const r = await call('DELETE', `/api/admin/api-keys/${id}`)
    console.log(r.status === 200 ? '✓ removed' : `✗ ${r.status}`)
    process.exit(r.status === 200 ? 0 : 1)
  }
}

async function cmdStats() {
  const r = await call('GET', '/api/admin/stats')
  if (r.status !== 200) { console.error('failed:', r.status); process.exit(1) }
  if (r.data.length === 0) { console.log('(no stats yet)'); return }
  console.log('provider_id\tmodel\tapi_key_id\treqs\tin\tout\tcached')
  for (const s of r.data) {
    console.log(`${s.provider_id}\t${s.model_name}\t${s.api_key_id}\t${s.request_count}\t${s.input_tokens}\t${s.output_tokens}\t${s.cached_tokens}`)
  }
}

async function cmdQuit() { /* ponytail: alias exit, in case user types quit */ }

const CMDS = {
  setup: cmdSetup, health: cmdHealth, status: cmdStatus, login: cmdLogin,
  database: cmdDatabase, settings: cmdSettings, password: cmdPasswordChange,
  shutdown: cmdShutdown, restart: cmdRestart,
  provider: cmdProviders, providers: cmdProviders,
  apikey: cmdApikeys, apikeys: cmdApikeys,
  stats: cmdStats,
  quit: cmdQuit,
  help: () => console.log('commands:\n  ' + Object.keys(CMDS).filter(k => !['quit','help'].includes(k)).join('\n  ')),
}

// ponytail: global flags (-H, --host, --port, -P, --password) may appear before
// or interspersed with the subcommand. `command.subcommand` style. Walk argv
// collecting recognized flags, then take the first unrecognized token as the
// subcommand.
const GLOBAL_FLAGS = new Set(['-H', '--host', '--port', '-P', '--password'])
function findSubcommand() {
  const argv = process.argv.slice(2)
  let i = 0
  while (i < argv.length) {
    const a = argv[i]
    if (GLOBAL_FLAGS.has(a)) { i += 2; continue }
    if (a.startsWith('--host=') || a.startsWith('--port=') || a.startsWith('--password=')) { i++; continue }
    if (a === '-H' || a === '-P') { i += 2; continue }
    return a
  }
  return 'help'
}

const sub = findSubcommand()
const fn = CMDS[sub]
if (!fn) { console.error('unknown command:', sub); process.exit(1) }
fn().catch(e => { console.error(e); process.exit(1) })
