// ponytail: conf + DB paths come from CLI flags (-c / -D). Fallback: next to the running
// binary (process.execPath when packaged, dirname(import.meta.url) when run via `node`).
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'

const md5 = (s) => crypto.createHash('md5').update(s).digest('hex')

// ponytail: unified data dir. One subdir across all three launchers (cli / desktop / standalone server).
// Always `~/.cj-nantianmen/` on every OS. User explicitly chose this over platform-specific appData.
function defaultBaseDir() {
  return path.join(os.homedir(), '.cj-nantianmen')
}

// ponytail: lazy init. setPaths() must be called by server/index.js BEFORE loadConf().
let _confPath = null
let _dbPath = null

export function setPaths({ confPath, dbPath } = {}) {
  if (confPath) _confPath = path.resolve(confPath)
  if (dbPath) _dbPath = path.resolve(dbPath)
}

// ponytail: paths resolved at first read. setPaths() influences defaults for the very first call.
let _resolvedBase = null
function base() {
  if (!_resolvedBase) _resolvedBase = defaultBaseDir()
  return _resolvedBase
}

let _resolvedConfPath = null
function confPathLazy() {
  if (_resolvedConfPath) return _resolvedConfPath
  _resolvedConfPath = _confPath || path.join(base(), 'nantianmen-conf.json')
  return _resolvedConfPath
}

let _dirsReady = false
function ensureDirs() {
  if (_dirsReady) return
  _dirsReady = true
  // ponytail: home dir may not exist yet on first run (e.g. fresh VM).
  try { fs.mkdirSync(path.dirname(getConfPath()), { recursive: true }) } catch {}
  try { fs.mkdirSync(path.dirname(getDefaultDbPath()), { recursive: true }) } catch {}
}

export function getConfPath() { ensureDirs(); return _confPath || confPathLazy() }
export function getConfDir() { return path.dirname(getConfPath()) }
export function getDefaultDbPath() { ensureDirs(); return _dbPath || path.join(base(), 'nantianmen.db') }

function defaultDbPath() { return getDefaultDbPath() }

export const DEFAULT_CONF = () => ({
  initialized: true,
  server_host: '127.0.0.1',
  server_port: 38271,
  password: '',
  salt: '',
  log_enabled: false,
  // ponytail: outbound proxy for upstream LLM calls. `system` uses env HTTPS_PROXY/ALL_PROXY,
  // `direct` bypasses any system proxy, `custom` uses `proxy_url` (e.g. http://host:port or socks5://host:port).
  proxy: 'system',
  proxy_url: '',
  database: { type: 'sqlite3', path: defaultDbPath() },
})

let _conf = null

export function loadConf() {
  const cp = getConfPath()
  if (fs.existsSync(cp)) {
    _conf = JSON.parse(fs.readFileSync(cp, 'utf8'))
  } else {
    _conf = { ...DEFAULT_CONF() }
    if (!_conf.salt) _conf.salt = randomSalt()
    // ponytail: bootstrap password so admin auth has something to verify against.
    // Default 'admin' md5 + salt → stored hash. Users can change later via /password/change.
    if (!_conf.password) {
      _conf.password = md5(md5('admin') + _conf.salt)
    }
    saveConf()
  }
  // ponytail: relative DB paths always resolve against conf dir (exeDir in portable).
  // First-run path: conf didn't exist → DEFAULT_CONF had raw "./nantianmen.db" or setPaths()'s path → must resolve.
  if (_conf.database && _conf.database.path && !path.isAbsolute(_conf.database.path)) {
    _conf.database.path = path.resolve(getConfDir(), _conf.database.path)
  }
  return _conf
}

export function getConf() {
  if (_conf === null) loadConf()
  return _conf
}

export function updateConf(patch) {
  Object.assign(_conf, patch)
  saveConf()
  return _conf
}

export function saveConf() {
  fs.writeFileSync(getConfPath(), JSON.stringify(_conf, null, 2))
}

export function randomSalt() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let s = ''
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)]
  return s
}
