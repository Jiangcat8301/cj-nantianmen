#!/usr/bin/env node
// nantianmen CLI v0.2. stdlib only.
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fork, spawn } from 'node:child_process'
import { prompt, askSecret } from './prompt.js'
import cliPackage from './package.json' with { type: 'json' }

const md5 = (s) => crypto.createHash('md5').update(s).digest('hex')
const CLIENT_VERSION = cliPackage.version

const CFG_DIR = path.join(os.homedir(), '.cj-nantianmen')
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

// ponytail: probe server health; if down, fork it with -c/-D pointing at the server
// binary's directory (NOT the launcher's dir) — conf+db must live next to server.
const HEALTH_TIMEOUT_MS = 1500
async function probeHealth(host, port) {
  return new Promise((resolve) => {
    const offline = { online: false, compatible: false, serverVersion: null }
    const timer = setTimeout(() => resolve(offline), HEALTH_TIMEOUT_MS)
    fetch(`http://${host}:${port}/v1/health`).then(async (r) => {
      clearTimeout(timer)
      let data = null
      try { data = await r.json() } catch {}
      const online = r.ok && data?.service === 'nantianmen'
      resolve({ online, compatible: online && data.version === CLIENT_VERSION, serverVersion: data?.version || null })
    }).catch(() => { clearTimeout(timer); resolve(offline) })
  })
}

function rejectVersionMismatch(status) {
  console.error(`✗ Server/Client version mismatch: CLI ${CLIENT_VERSION}, Server ${status.serverVersion || 'unknown'}. Stop the existing Server and start the matching version.`)
  process.exit(1)
}

function resolveServerEntry() {
  const envOverride = process.env.NANTIANMEN_SERVER_BIN
  if (envOverride) return envOverride
  const flagBin = flagValue(process.argv, '--server-bin')
  if (flagBin) return flagBin
  // ponytail: dev fallback — ../server/index.js relative to this CLI script.
  // Bun-compiled exe: look next to the exe.
  const exeDir = path.dirname(process.execPath)
  const bundledEntry = path.join(exeDir, 'server', 'index.js')
  if (fs.existsSync(bundledEntry)) return bundledEntry
  const cliDir = path.dirname(new URL(import.meta.url).pathname.replace(/^\//, ''))
  const devEntry = path.join(cliDir, '..', 'server', 'index.js')
  if (fs.existsSync(devEntry)) return devEntry
  console.error('✗ no server entry found. Pass --server-bin /path/to/server/index.js or set $NANTIANMEN_SERVER_BIN')
  process.exit(1)
}

// ponytail: spawn server if not already running. conf+db land in the shared appData
// dir (server's defaultBaseDir handles platform-specific path) — same as desktop.
// Don't override with launcher-local paths; the three launchers must share state.
async function ensureServer(args) {
  const existing = await probeHealth(args.host, args.port)
  if (existing.compatible) return 'already-up'
  if (existing.online) rejectVersionMismatch(existing)
  const serverEntry = resolveServerEntry()
  console.error(`(launching server from ${serverEntry})`)
  const nodeBin = process.platform === 'win32' ? 'node.exe' : 'node'
  // ponytail: 'pipe' stdout (was 'ignore') so we can read [ntm-cleanup] lines and print a hint
  // when legacy schema cleanup is running on first boot. stderr still piped so pino logs surface.
  let cleanupStarted = false
  let cleanupDone = false
  const child = spawn(nodeBin, [serverEntry], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NANTIANMEN_LOCAL_MODE: process.env.NANTIANMEN_LOCAL_MODE || '' },
  })
  child.unref()
  child.stdout?.on('data', (d) => {
    const s = d.toString()
    if (!cleanupStarted && /\[ntm-cleanup\] start/.test(s)) {
      cleanupStarted = true
      console.error('[server] database schema cleanup running (one-time)...')
    } else if (cleanupStarted && !cleanupDone && /\[ntm-cleanup\] done/.test(s)) {
      cleanupDone = true
      console.error('[server] schema cleanup done.')
    }
  })
  child.stderr?.on('data', () => { /* pino logs are noisy; swallow */ })
  for (let i = 0; i < 30; i++) {
    const status = await probeHealth(args.host, args.port)
    if (status.compatible) return 'launched'
    if (status.online) rejectVersionMismatch(status)
    await new Promise(r => setTimeout(r, 200))
  }
  console.error('✗ failed to start server within 6s')
  process.exit(1)
}

function resolveArgs() {
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
  // ponytail: when body is undefined, omit Content-Type so server doesn't reject "empty body with JSON type".
  const hasBody = body !== undefined
  const h = { ...(hasBody ? { 'Content-Type': 'application/json' } : {}), ...headers }
  if (!noAuth && args.password_md5 && !h.Authorization) h.Authorization = `Bearer ${args.password_md5}`
  const resp = await fetch(url, { method, headers: h, body: hasBody ? JSON.stringify(body) : undefined })
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
  const args = process.argv.slice(3)
  const sub = args[0]
  // ponytail: sub-routes — info (read) and move (server-side relocates the file).
  if (sub === 'info' || !sub) {
    const r = await call('GET', '/api/admin/database/info')
    if (r.status !== 200) { console.error('failed:', r.status, JSON.stringify(r.data)); process.exit(1) }
    const sizeMB = (r.data.size / 1048576).toFixed(2)
    console.log(`type:     ${r.data.type}`)
    console.log(`path:     ${r.data.path}`)
    console.log(`size:     ${r.data.size} bytes (${sizeMB} MB)`)
    console.log(`log_count: ${r.data.log_count ?? 0}`)
    return
  }
  if (sub === 'move') {
    const target = args[1] || await prompt('New DB path (absolute): ')
    const r = await call('POST', '/api/admin/database/move', { path: target })
    console.log(r.status === 200 ? `✓ moved to ${r.data.path ?? target}` : `✗ ${r.status} ${JSON.stringify(r.data)}`)
    return
  }
  if (sub === 'configure' || sub === 'config') {
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
    return
  }
  console.error('usage: nantianmen database [info|configure|move]')
}

async function cmdSettings() {
  const args = process.argv.slice(3)
  if (args[0] === 'set') {
    const pi = args.indexOf('--port')
    const port = pi !== -1 ? Number(args[pi+1]) : undefined
    const hi = args.indexOf('--host')
    const host = hi !== -1 ? args[hi+1] : undefined
    if (!port && !host) { console.error('usage: nantianmen settings set --port=N [--host=H]'); process.exit(1) }
    const r = await call('PUT', '/api/admin/settings', { ...(host ? { host } : {}), ...(port ? { port } : {}) })
    console.log(r.status === 200 ? `✓ updated${r.data.restart_required ? ' (restart required)' : ''}` : `✗ ${r.status}`)
    return
  }
  const r = await call('GET', '/api/admin/settings')
  console.log(JSON.stringify(r.data, null, 2))
}

// ponytail: outbound proxy management (system / direct / custom <url>).
async function cmdProxy() {
  const args = process.argv.slice(3)
  if (args[0] === 'set') {
    const mode = args[1]
    if (!['system', 'direct', 'custom'].includes(mode)) { console.error('usage: nantianmen proxy set <system|direct|custom> [url]'); process.exit(1) }
    const url = args[2] || ''
    if (mode === 'custom' && !url) { console.error('custom mode requires a proxy URL'); process.exit(1) }
    const r = await call('PUT', '/api/admin/proxy', { mode, url })
    console.log(r.status === 200 ? `✓ proxy mode set to ${r.data.mode}${r.data.url ? ` (${r.data.url})` : ''}` : `✗ ${r.status} ${r.data?.error || ''}`)
    return
  }
  const r = await call('GET', '/api/admin/proxy')
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
    if (!name) { console.error('name required'); process.exit(1) }
    // ponytail: v0.2.14 — pre-check duplicate (DB UNIQUE returns 400 anyway, friendlier here).
    const ls = await call('GET', '/api/admin/providers')
    if (ls.status === 200 && Array.isArray(ls.data) && ls.data.some(p => p.name === name)) {
      console.error(`✗ provider '${name}' already exists`)
      process.exit(1)
    }
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
  // ponytail: model subcommands
  if (sub === 'models' || sub === 'model-ls') {
    const pid = args[1] || await prompt('Provider id: ')
    const r = await call('GET', `/api/admin/providers/${pid}/models`)
    if (r.status !== 200) { console.error('failed:', r.status); process.exit(1) }
    for (const m of r.data) console.log(`${m.id}\t${m.model_name}\t${m.is_default ? '★default' : ''}\t${m.is_manual ? 'manual' : ''}\t${m.deleted_at ? 'DELETED' : ''}\tin:¥${m.input_price||0}\tout:¥${m.output_price||0}\tcache:¥${m.cache_hit_price||0}`)
    return
  }
  if (sub === 'models-refresh') {
    const pid = args[1] || await prompt('Provider id: ')
    const r = await call('POST', `/api/admin/providers/${pid}/models/refresh`)
    console.log(r.status === 200 ? `✓ ${r.data.models?.length ?? 0} models` : `✗ ${r.status}`)
    return
  }
  if (sub === 'model-add') {
    const pid = args[1] || await prompt('Provider id: ')
    const name = args[2] || await prompt('Model name: ')
    const r = await call('POST', `/api/admin/providers/${pid}/models`, { model_name: name })
    console.log(r.status === 200 ? `✓ added id=${r.data.id}` : `✗ ${r.status}`)
    return
  }
  if (sub === 'model-edit') {
    const pid = args[1] || await prompt('Provider id: ')
    const mid = args[2] || await prompt('Model id: ')
    // ponytail: parse --input/--output/--cache flags from remaining args
    const flag = (name) => { const i = args.indexOf(name); return i !== -1 ? Number(args[i+1]) : undefined }
    const r = await call('PUT', `/api/admin/providers/${pid}/models/${mid}`, {
      input_price: flag('--input'), output_price: flag('--output'), cache_hit_price: flag('--cache'),
    })
    console.log(r.status === 200 ? `✓ updated` : `✗ ${r.status}`)
    return
  }
  if (sub === 'default') {
    const pid = args[1] || await prompt('Provider id: ')
    const mid = args[2] || await prompt('Model id: ')
    const r = await call('PUT', `/api/admin/providers/${pid}/models/${mid}/default`)
    console.log(r.status === 200 ? '✓ set as default' : `✗ ${r.status}`)
    return
  }
  if (sub === 'model-toggle') {
    const pid = args[1] || await prompt('Provider id: ')
    const mid = args[2] || await prompt('Model id: ')
    const r = await call('PUT', `/api/admin/providers/${pid}/models/${mid}/toggle`)
    console.log(r.status === 200 ? `✓ ${r.data.is_disabled ? 'disabled' : 'enabled'} id=${r.data.id}` : `✗ ${r.status} ${JSON.stringify(r.data)}`)
    return
  }
  console.error('usage: nantianmen provider [ls|add|rm|models|models-refresh|model-add|model-edit|model-toggle|default]')
}

async function cmdApikeys() {
  const args = process.argv.slice(3)
  const sub = args[0]
  if (sub === 'ls' || !sub) {
    const r = await call('GET', '/api/admin/api-keys')
    if (r.status !== 200) { console.error('failed:', r.status, JSON.stringify(r.data)); process.exit(1) }
    // ponytail: v0.2.14 — also print authorized model count
    for (const k of r.data) {
      const authN = (k.authorized_models || []).length
      console.log(`${k.id}\t${k.key}\t${k.name}\t${k.note}\t${k.assigned_model || '-'}\t${k.last_used_at || '-'}\tauth:${authN}`)
    }
    return
  }
  if (sub === 'new') {
    const name = await prompt('Name: ')
    const note = await prompt('Note: ')
    // ponytail: v0.2.14 — interactive multi-select for authorized models.
    // Fetch available list, show numbered, user enters comma-separated numbers (or empty to skip).
    const avail = await call('GET', '/api/admin/api-keys/available-models')
    let model_ids = []
    if (avail.status === 200 && Array.isArray(avail.data) && avail.data.length > 0) {
      console.log('\nAvailable models (system default is implicitly available to all keys):')
      avail.data.forEach((m, i) => console.log(`  ${(i+1).toString().padStart(3)}) ${m.provider_name}_${m.model_name}${m.is_default ? '  ★' : ''}${m.deleted_at ? '  (deleted)' : m.is_disabled ? '  (disabled)' : ''}`))
      console.log('\nSelect authorized models (comma-separated numbers, "all" for all, empty to skip):')
      const sel = (await prompt('> ')).trim()
      if (sel === 'all') {
        model_ids = avail.data.map(m => m.id)
      } else if (sel) {
        const picks = sel.split(',').map(s => parseInt(s.trim()) - 1).filter(i => i >= 0 && i < avail.data.length)
        model_ids = picks.map(i => avail.data[i].id)
      }
      console.log(`  → ${model_ids.length} model(s) authorized`)
    }
    const r = await call('POST', '/api/admin/api-keys', { name, note, model_ids })
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
  if (sub === 'edit') {
    const id = args[1] || await prompt('Key id: ')
    // ponytail: v0.2.14 — read flags --assigned=<model_id>, --auth=<id,id,...> for non-interactive use.
    const flag = (n) => { const i = args.indexOf(n); return i !== -1 ? args[i+1] : undefined }
    let name = flag('--name')
    let note = flag('--note')
    let oldName = flag('--old-name') || name || ''
    let body = {}
    if (name) body.name = name
    if (note) body.note = note
    if (oldName) body.old_name = oldName
    const assigned = flag('--assigned')
    if (assigned === '-') body.assigned_model_id = null
    else if (assigned !== undefined) body.assigned_model_id = Number(assigned)
    const auth = flag('--auth')
    if (auth !== undefined) body.model_ids = auth === '' ? [] : auth.split(',').map(s => Number(s.trim())).filter(n => Number.isFinite(n))
    if (Object.keys(body).length === 0) {
      // ponytail: interactive fallback (no flags) — ask name/note, then optionally pick model from authorized list.
      name = await prompt('New name: ')
      note = await prompt('New note: ')
      oldName = name || ''
      body = { name, note, old_name: oldName }
      // list current key (to show existing assignment + authorized set)
      const cur = await call('GET', '/api/admin/api-keys')
      const key = Array.isArray(cur.data) ? cur.data.find(k => String(k.id) === String(id)) : null
      if (key) {
        if (key.assigned_model_id) console.log(`currently assigned: ${key.assigned_model} (model_id=${key.assigned_model_id})`)
        if (key.authorized_models?.length) {
          console.log('authorized models:')
          key.authorized_models.forEach((m, i) => console.log(`  ${(i+1).toString().padStart(3)}) ${m.provider_name}_${m.model_name}`))
          const a = (await prompt('New assigned model id (1-based) or - to clear (empty to keep): ')).trim()
          if (a === '-') body.assigned_model_id = null
          else if (a) {
            const idx = parseInt(a) - 1
            if (idx >= 0 && idx < key.authorized_models.length) body.assigned_model_id = key.authorized_models[idx].model_id
          }
        } else {
          console.log('(no authorized models; assign first via --auth=... or interactive new)')
        }
      }
    }
    const r = await call('PUT', `/api/admin/api-keys/${id}`, body)
    console.log(r.status === 200 ? `✓ updated${r.data?.assigned_model ? ' (assigned: ' + r.data.assigned_model + ')' : r.data?.assigned_model === null ? ' (no assignment)' : ''}` : `✗ ${r.status} ${JSON.stringify(r.data)}`)
    return
  }
}

// ponytail: shared token cost formula — mirrors desktop/src/lib/format.js::calcCost.
// (input - cached) * input_price + output * output_price + cached * cache_hit_price.
// Keep the three copies (server lib / desktop lib / CLI) in sync — see Bug 24.
const calcCost = (r) =>
  ((r.input_tokens || 0) - (r.cached_tokens || 0)) * (r.input_price || 0) / 1_000_000
  + (r.output_tokens || 0) * (r.output_price || 0) / 1_000_000
  + (r.cached_tokens || 0) * (r.cache_hit_price || 0) / 1_000_000

async function cmdStats() {
  // ponytail: support --range=today|7d|30d flag
  const args = process.argv.slice(3)
  const ri = args.indexOf('--range')
  const range = ri !== -1 ? args[ri+1] : ''
  const qs = range ? `?range=${range}` : ''
  const r = await call('GET', '/api/admin/stats' + qs)
  if (r.status !== 200) { console.error('failed:', r.status); process.exit(1) }
  const d = r.data
  console.log(`total: ${d.total_requests||0} reqs  in:${d.total_input_tokens||0}  out:${d.total_output_tokens||0}  cached:${d.total_cached_tokens||0}`)
  if (d.topModels?.length) {
    console.log('\nTop models:')
    for (const m of d.topModels) console.log(`  ${m.model}\treqs:${m.request_count}\tin:${m.input_tokens}\tout:${m.output_tokens}\tcached:${m.cached_tokens}\tcost:¥${calcCost(m).toFixed(4)}`)
  }
  if (d.topProviders?.length) {
    console.log('\nTop providers:')
    for (const p of d.topProviders) console.log(`  ${p.provider}\treqs:${p.request_count}\tin:${p.input_tokens}\tout:${p.output_tokens}\tcached:${p.cached_tokens}\tcost:¥${(p.cost ?? 0).toFixed(4)}`)
  }
  // ponytail: aggregate breakdown by provider → model (matches desktop Stats.vue providerGroups).
  // per-api_key detail lives in `nantianmen apikey ls` + the Users management UI, not here.
  const byProv = new Map()
  for (const s of (d.breakdown || [])) {
    const prov = s.provider || '?'
    let g = byProv.get(prov) || { provider: prov, models: new Map() }
    g.req = (g.req || 0) + (s.request_count || 0)
    g.in = (g.in || 0) + (s.input_tokens || 0)
    g.out = (g.out || 0) + (s.output_tokens || 0)
    g.cached = (g.cached || 0) + (s.cached_tokens || 0)
    g.cost = (g.cost || 0) + calcCost(s)
    const mn = s.model_name || '?'
    let m = g.models.get(mn) || { model_name: mn }
    m.req = (m.req || 0) + (s.request_count || 0)
    m.in = (m.in || 0) + (s.input_tokens || 0)
    m.out = (m.out || 0) + (s.output_tokens || 0)
    m.cached = (m.cached || 0) + (s.cached_tokens || 0)
    m.cost = (m.cost || 0) + calcCost(s)
    g.models.set(mn, m)
    byProv.set(prov, g)
  }
  if (!byProv.size) { console.log('(no breakdown)'); return }
  console.log('\nBy provider:')
  const provList = [...byProv.values()].sort((a, b) => b.req - a.req)
  for (const g of provList) {
    console.log(`  ${g.provider}\treqs:${g.req}\tin:${g.in}\tout:${g.out}\tcached:${g.cached}\tcost:¥${g.cost.toFixed(4)}`)
    const models = [...g.models.values()].sort((a, b) => b.req - a.req)
    for (const m of models) console.log(`    ${m.model_name}\treqs:${m.req}\tin:${m.in}\tout:${m.out}\tcached:${m.cached}\tcost:¥${m.cost.toFixed(4)}`)
  }
}

async function cmdDefaultModel() {
  const r = await call('GET', '/api/admin/default-model')
  if (r.status !== 200) { console.error('failed:', r.status, JSON.stringify(r.data)); process.exit(1) }
  if (!r.data) { console.log('(no default model set)'); return }
  console.log(`default: ${r.data.provider_name}_${r.data.model_name}  (${r.data.protocol})`)
  console.log(`id for /v1/models: Nantianmen-default`)
}

async function cmdQuit() { /* ponytail: alias exit, in case user types quit */ }

async function cmdLog() {
  const args = process.argv.slice(3)
  const sub = args[0]
  if (sub === 'ls' || !sub) {
    // ponytail: parse --lines/-L, default 20. Also support --page for multi-page view.
    let lines = 20, p = 1
    const params = { page: 1, per_page: 20 }
    for (let i = 1; i < args.length; i++) {
      if ((args[i] === '--lines' || args[i] === '-L') && args[i+1]) { lines = parseInt(args[++i]); params.per_page = lines }
      else if (args[i] === '--page' && args[i+1]) { p = parseInt(args[++i]); params.page = p }
      else if (args[i] === '--provider' && args[i+1]) params.provider_id = args[++i]
      else if (args[i] === '--model' && args[i+1]) params.model_name = args[++i]
      else if (args[i] === '--user' && args[i+1]) params.user_id = args[++i]
    }
    const qs = Object.entries(params).filter(([,v]) => v !== undefined && v !== '').map(([k,v]) => `${k}=${v}`).join('&')
    const r = await call('GET', '/api/admin/communication-log' + (qs ? '?' + qs : ''))
    if (r.status !== 200) { console.error('failed:', r.status); process.exit(1) }
    const data = r.data.rows || r.data  // ponytail: paginated returns {rows, total}; legacy returns array
    if (!Array.isArray(data) || data.length === 0) { console.log('(no log entries)'); return }
    // ponytail: header row so the columns are readable in plain terminal output.
    console.log('time\tuser\tprovider\tmodel\tin_tokens\tout_tokens\tcached\tduration\tstatus')
    for (const l of data) {
      console.log(`${l.time}\t${l.user_name||l.user_id}\t${l.provider_name}\t${l.model_name}\tin:${l.tokens_input}\tout:${l.tokens_output}\tcached:${l.tokens_cached}\tdur:${l.duration_ms == null ? '-' : l.duration_ms + 'ms'}\t${l.error ? '✕'+l.error.code : '✓'}`)
    }
    const tot = r.data.total
    if (tot && tot > data.length) console.log(`\n(page ${r.data.page || p}, ${data.length} of ${tot} total)`)
    return
  }
  if (sub === 'clear') {
    const r = await call('DELETE', '/api/admin/communication-log')
    console.log(r.status === 200 ? '✓ cleared' : '✗ ' + r.status)
    return
  }
  if (sub === 'config') {
    const r = await call('GET', '/api/admin/communication-log/config')
    console.log(`log_enabled:          ${r.data?.log_enabled ?? false}`)
    console.log(`log_rotation_enabled: ${r.data?.log_rotation_enabled ?? false}`)
    console.log(`log_rotation_max:     ${r.data?.log_rotation_max ?? 1000}`)
    return
  }
  if (sub === 'rotation') {
    const args2 = args.slice(1)
    const body = {}
    for (let i = 0; i < args2.length; i++) {
      if (args2[i] === '--on' || args2[i] === '--enable') body.log_rotation_enabled = true
      else if (args2[i] === '--off' || args2[i] === '--disable') body.log_rotation_enabled = false
      else if (args2[i] === '--max' && args2[i+1]) { body.log_rotation_max = parseInt(args2[++i]) || 1000 }
    }
    if (Object.keys(body).length === 0) {
      const r = await call('GET', '/api/admin/communication-log/config')
      console.log(`log_rotation_enabled: ${r.data?.log_rotation_enabled ?? false}`)
      console.log(`log_rotation_max:     ${r.data?.log_rotation_max ?? 1000}`)
      return
    }
    const r = await call('PUT', '/api/admin/communication-log/config', body)
    console.log(r.status === 200 ? '✓ rotation updated' : '✗ ' + r.status)
    return
  }
  if (sub === 'enable' || sub === 'disable') {
    const r = await call('PUT', '/api/admin/communication-log/config', { log_enabled: sub === 'enable' })
    console.log(r.status === 200 ? `✓ log ${sub}d` : '✗ ' + r.status)
    return
  }
  console.error('usage: nantianmen log [ls|clear|enable|disable|config|rotation] [--provider ID] [--model NAME] [--user ID]')
}

const CMDS = {
  setup: cmdSetup, health: cmdHealth, status: cmdStatus, login: cmdLogin,
  database: cmdDatabase, settings: cmdSettings, proxy: cmdProxy, password: cmdPasswordChange,
  shutdown: cmdShutdown, restart: cmdRestart,
  provider: cmdProviders, providers: cmdProviders,
  apikey: cmdApikeys, apikeys: cmdApikeys,
  stats: cmdStats,
  log: cmdLog,
  'default-model': cmdDefaultModel, default_model: cmdDefaultModel,
  quit: cmdQuit,
  help: () => console.log('commands:\n  ' + Object.keys(CMDS).filter(k => !['quit','help'].includes(k)).join('\n  ')),
}

// ponytail: global flags (-H, --host, --port, -P, --password, --server-bin) may appear
// before or interspersed with the subcommand. `command.subcommand` style. Walk argv
// collecting recognized flags, then take the first unrecognized token as the subcommand.
const GLOBAL_FLAGS = new Set(['-H', '--host', '--port', '-P', '--password', '--server-bin'])
function findSubcommand() {
  const argv = process.argv.slice(2)
  let i = 0
  while (i < argv.length) {
    const a = argv[i]
    if (GLOBAL_FLAGS.has(a)) { i += 2; continue }
    if (a.startsWith('--host=') || a.startsWith('--port=') || a.startsWith('--password=') || a.startsWith('--server-bin=')) { i++; continue }
    if (a === '-H' || a === '-P') { i += 2; continue }
    return a
  }
  return 'help'
}

const sub = findSubcommand()
const fn = CMDS[sub]
if (!fn) { console.error('unknown command:', sub); process.exit(1) }

// ponytail: every command needs the server reachable. Probe first, launch if down,
// then dispatch. setup/login/health are tolerated even if server is unreachable
// (those help you get the server up in the first place).
const SERVERLESS = new Set(['help', 'quit'])
;(async () => {
  const args = resolveArgs()
  if (!SERVERLESS.has(sub)) {
    await ensureServer(args)
  }
  // ponytail: help/quit handlers return undefined; await the call so their side-effects (console.log) run.
  const r = fn()
  if (r && typeof r.catch === 'function') r.catch(e => { console.error(e); process.exit(1) })
})()
