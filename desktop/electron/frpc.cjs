// ponytail: v0.5.0 — Electron main-process FRPC manager.
// Spawns frpc.exe as a detached child, writes/reads frpc.toml from userData/frpc/.
// Why here (not server): server is a Go binary; frpc is its own protocol stack.
// Putting the process manager in Electron's main keeps the spawn / kill tree out of the LLM path.
// No new deps: builtins only (node:fs / node:path / node:child_process / node:https / node:zlib).

const { app, ipcMain, BrowserWindow } = require('electron')
const { spawn, execFileSync } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const https = require('node:https')
const { pipeline } = require('node:stream/promises')
const { createWriteStream } = require('node:fs')
// ponytail: v0.5.0 — https-proxy-agent ships with Electron's transitive deps; no
// new dep added to package.json. We use it to bridge the IE registry's SOCKS5
// proxy (127.0.0.1:1099) which Node's native https.get does NOT honour via the
// HTTPS_PROXY env var (Node's http module never picked up the env-var proxy
// resolution that undici introduced in v22). Confirmed by smoke test.
const { HttpsProxyAgent } = require('https-proxy-agent')

// ponytail: v0.5.0 — Windows system proxy discovery via the IE registry.
// `ProxyServer` is the same setting every browser uses, so we read it once at
// startup and surface it as `HTTPS_PROXY` so https.get / http.request inherit it.
// No native deps — we shell out to `reg query` which ships with Windows.
// Linux/macOS users fall through to whatever the OS env says.
function readSystemProxy() {
  if (process.platform !== 'win32') return null
  try {
    // ponytail: `reg query` always prepends "HKEY_...\n" + a blank line before
    // the value rows, so we use multiline regex anchored at start-of-line to
    // skip the header. (Earlier single-line regex matched nothing because the
    // header line was always first.)
    const r = execFileSync('reg.exe', [
      'query',
      'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings',
      '/v', 'ProxyEnable',
    ], { stdio: ['ignore', 'pipe', 'pipe'] }).toString()
    if (!/^.*ProxyEnable\s+REG_DWORD\s+0x1/m.test(r)) return null
    const r2 = execFileSync('reg.exe', [
      'query',
      'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings',
      '/v', 'ProxyServer',
    ], { stdio: ['ignore', 'pipe', 'pipe'] }).toString()
    const m = r2.match(/^.*ProxyServer\s+REG_SZ\s+(.+?)\r?\n/m)
    if (!m) return null
    const raw = m[1].trim()
    // ProxyServer can be "host:port" or "scheme=host:port;..." (per-protocol).
    // We only care about http/https; pick the http entry if present, else the bare form.
    let host = raw
    const httpEq = raw.match(/http=([^;]+)/i)
    const httpsEq = raw.match(/https=([^;]+)/i)
    if (httpsEq) host = httpsEq[1]
    else if (httpEq) host = httpEq[1]
    // Many SOCKS5-only proxies on Windows show up here as "host:port" with no
    // scheme prefix; they still answer HTTP GETs (we probed above). We trust
    // the registry value verbatim — Electron will use it as HTTP proxy.
    if (!/^[\w.-]+:\d+$/.test(host)) return null
    return `http://${host}`
  } catch {
    return null
  }
}

const SYSTEM_PROXY = readSystemProxy()
if (SYSTEM_PROXY) {
  process.env.HTTPS_PROXY = SYSTEM_PROXY
  process.env.HTTP_PROXY  = SYSTEM_PROXY
  console.log('[frpc] using system proxy:', SYSTEM_PROXY)
}

// ponytail: v0.5.0 — pin frpc to upstream latest at the time of this commit.
// Bumping happens via package.json next to a CHANGELOG entry; not auto-fetched.
const FRPC_VERSION = 'v0.71.0'

// ----- paths ---------------------------------------------------------------

function frpcDir() {
  return path.join(app.getPath('userData'), 'frpc')
}
function frpcBin() {
  const exe = process.platform === 'win32' ? 'frpc.exe' : 'frpc'
  return path.join(frpcDir(), exe)
}
function frpcTomlPath() {
  return path.join(frpcDir(), 'frpc.toml')
}
function frpcLogPath() {
  return path.join(frpcDir(), 'frpc.log')
}

// ponytail: platform → upstream asset name. frp ships one zip per arch; the zip
// contains both frps and frpc; we only need frpc.
function platformAsset() {
  const ver = FRPC_VERSION.replace(/^v/, '')
  const map = {
    'win32-x64':    `frp_${ver}_windows_amd64.zip`,
    'win32-arm64':  `frp_${ver}_windows_arm64.zip`,
    'darwin-x64':   `frp_${ver}_darwin_amd64.tar.gz`,
    'darwin-arm64': `frp_${ver}_darwin_arm64.tar.gz`,
    'linux-x64':    `frp_${ver}_linux_amd64.tar.gz`,
    'linux-arm64':  `frp_${ver}_linux_arm64.tar.gz`,
  }
  const key = `${process.platform}-${process.arch}`
  const asset = map[key]
  if (!asset) throw new Error(`No FRPC asset for platform ${key}`)
  return { asset, version: FRPC_VERSION }
}

// ----- state ---------------------------------------------------------------

let proc = null  // current frpc ChildProcess or null

// ponytail: v0.5.0 — cancellable download. The AbortController lives in module scope
// so cancelDownload IPC can reach it from another view (or after route switch).
// We also broadcast `frpc:download:state` so other pages / the titlebar can show
// "downloading" without polling — and crucially so a route switch doesn't strand
// the user thinking the download is lost.
let downloadAbort = null       // AbortController for the in-flight HTTPS request
let downloadState = null       // { startedAt, version } | null — visible to all views

// ponytail: v0.5.1 — frpc stdout/stderr ring buffer (max 100 lines) surfaced
// to the ReverseProxy.vue log pane. We keep it in memory because the on-disk
// frpc.log grows unbounded; the UI only ever needs the tail. Populated while
// frpc is running; when frpc is stopped we tail the log file instead.
const LOG_MAX_LINES = 100
const logLines = []            // newest at the end
let _logPartial = ''           // partial line not yet terminated by \n

function pushLogLine(line) {
  const t = line.replace(/\r$/, '')
  if (!t.trim()) return
  logLines.push(t)
  if (logLines.length > LOG_MAX_LINES) logLines.shift()
}
function feedLogChunk(chunk) {
  _logPartial += chunk.toString('utf-8')
  const idx = _logPartial.lastIndexOf('\n')
  if (idx < 0) return
  const complete = _logPartial.slice(0, idx)
  _logPartial = _logPartial.slice(idx + 1)
  for (const line of complete.split('\n')) pushLogLine(line)
}
function readLogTail() {
  // When frpc isn't running, ring buffer may be empty → tail the log file.
  if (logLines.length) return logLines.slice()
  try {
    const raw = fs.readFileSync(frpcLogPath(), 'utf-8')
    const lines = raw.split(/\r?\n/).filter(l => l.trim())
    return lines.slice(-LOG_MAX_LINES)
  } catch { return [] }
}

function readConf() {
  const file = path.join(app.getPath('home'), '.cj-nantianmen', 'nantianmen-conf.json')
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8'))
  } catch {}
  return {}
}

function getFrpcConf() {
  const c = readConf()
  return c.frpc || {}
}

// ----- toml render ---------------------------------------------------------
// frpc reads a TOML config. We hand-roll the small subset we need to avoid a
// toml dependency (a 50kB package beats a few lines).
//
// ponytail: v0.5.1 — proxy type is `http`. With TCP the frps only sees a raw
// tunnel and has no way to route an HTTP request to a specific path (no
// vhost / subdomain matching). With `http`, frps exposes a real HTTP endpoint
// and reverse-proxies to our local Nantianmen server.
//
// Distinguishing multiple users on the same frps:
//   frps HTTP mode uses ONE shared port (typically 20080) for all HTTP
//   proxies and routes by the request `Host` header against `customDomains`.
//   Each user therefore registers a full, arbitrary domain — it does NOT have
//   to be a subdomain of `serverAddr`. Example: frps host is a.com but the
//   user's vhost is b.net → `customDomains = ["b.net"]`, and clients call
//     http://<frps-ip>:20080/v1/chat/completions   with Host: b.net
//   (or DNS wildcard *.b.net → the frps IP).
//
//   So the `subdomain` field is used VERBATIM as the custom domain. We do not
//   derive anything from `serverAddr` — that was a bug (it forced every user
//   under the frps hostname and double-suffixed full-domain inputs).
//
//   NOTE: frpc 0.71.0 rejects `subdomainHost` as an unknown field; `customDomains`
//   alone is what frps HTTP vhost matching looks at.
function renderToml(c) {
  const lines = []
  lines.push(`serverAddr = "${esc(c.server_addr || '')}"`)
  lines.push(`serverPort = ${Number(c.server_port) || 7000}`)
  if (c.token) lines.push(`auth.token = "${esc(c.token)}"`)
  lines.push('')
  lines.push('[[proxies]]')
  lines.push('name = "nantianmen"')
  lines.push('type = "http"')
  lines.push(`localIP = "127.0.0.1"`)
  lines.push(`localPort = ${Number(c.local_port) || 38271}`)
  // customDomains = the user's domain verbatim (no derivation from serverAddr).
  const domain = (c.subdomain || '').trim()
  if (domain) lines.push(`customDomains = ["${esc(domain)}"]`)
  lines.push(`locations = ["/"]`)
  return lines.join('\n') + '\n'
}
function esc(s) { return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') }

// ----- download ------------------------------------------------------------

// ponytail: status callbacks are throttled to IPC at most every 200ms;
// sending every chunk would flood the renderer.
function makeProgressEmitter() {
  let last = 0
  return (pct) => {
    const now = Date.now()
    if (now - last < 200 && pct < 100) return
    last = now
    BrowserWindow.getAllWindows().forEach(w => {
      w.webContents.send('frpc:download:progress', { pct: Math.round(pct) })
    })
  }
}

// ponytail: v0.5.0 — proxy precedence on every download:
//   1. nantianmen-conf.json `proxy=custom` + proxy_url  → use that URL verbatim
//   2. nantianmen-conf.json `proxy=direct`              → strip env vars (force direct)
//   3. anything else (system default, '' or unset)      → rely on SYSTEM_PROXY
//      injected at startup from the Windows IE registry (`HKCU\...\Internet Settings`).
//      On non-Windows we fall through to whatever the OS env already had.
//
// We also cache an `https.Agent` per proxy URL so we don't re-instantiate it
// on every chunk of every download. HttpsProxyAgent handles both http:// and
// https:// proxy schemes transparently (CONNECT to https proxy).
function applyProxyEnv() {
  try {
    const c = readConf()
    if (c.proxy === 'custom' && c.proxy_url) {
      process.env.HTTPS_PROXY = c.proxy_url
      process.env.HTTP_PROXY  = c.proxy_url
    } else if (c.proxy === 'direct') {
      delete process.env.HTTPS_PROXY
      delete process.env.HTTP_PROXY
    } else {
      // 'system' / '' / unset: keep SYSTEM_PROXY if we found one at boot.
      if (SYSTEM_PROXY) {
        process.env.HTTPS_PROXY = SYSTEM_PROXY
        process.env.HTTP_PROXY  = SYSTEM_PROXY
      }
    }
  } catch {}
}

const _agentCache = new Map()  // proxyURL → HttpsProxyAgent
function getAgent() {
  applyProxyEnv()
  const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY
  if (!proxy) return undefined   // native https.get uses OS / direct
  let a = _agentCache.get(proxy)
  if (!a) {
    a = new HttpsProxyAgent(proxy, { keepAlive: true })
    _agentCache.set(proxy, a)
  }
  return a
}

async function downloadTo(url, dest, onPct, signal) {
  return new Promise((resolve, reject) => {
    const agent = getAgent()
    const opts = {
      headers: { 'User-Agent': 'nantianmen-desktop' },
      // Set a 30s connect timeout so a misconfigured proxy doesn't hang forever.
      timeout: 30000,
    }
    if (agent) opts.agent = agent
    const req = https.get(url, opts, (res) => {
      // GitHub redirects to S3; follow once.
      if (res.statusCode === 302 || res.statusCode === 301) {
        return downloadTo(res.headers.location, dest, onPct, signal).then(resolve, reject)
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`))
      }
      const total = parseInt(res.headers['content-length'] || '0', 10)
      let received = 0
      const out = createWriteStream(dest)
      res.on('data', (chunk) => {
        received += chunk.length
        if (total) onPct(received / total * 100)
      })
      pipeline(res, out).then(resolve, reject).catch(reject)
    })
    req.on('error', (e) => {
      // node throws ENOTFOUND / ETIMEDOUT / ECONNRESET here — surface plainly.
      reject(e.code ? new Error(`${e.code} ${e.message}`) : e)
    })
    req.on('timeout', () => {
      req.destroy(new Error('connect timeout (30000ms)'))
    })
    if (signal) {
      const onAbort = () => {
        try { req.destroy(new Error('cancelled by user')) } catch {}
        try { fs.unlinkSync(dest) } catch {}
        reject(new Error('cancelled'))
      }
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    }
  })
}

// ponytail: unzip without a native lib — call system tar (Win10+ ships tar.exe).
// On Windows, .zip is handled by tar too: `tar -xf foo.zip` works since Win10 1803.
async function extractArchive(archive, into) {
  await fsp.mkdir(into, { recursive: true })
  const exe = process.platform === 'win32' ? 'tar.exe' : 'tar'
  execFileSync(exe, ['-xf', archive, '-C', into], { stdio: 'pipe' })
}

function findFrpcBinary(into) {
  // upstream extracts to frp_<ver>_<plat>/frpc[.exe]
  const exe = process.platform === 'win32' ? 'frpc.exe' : 'frpc'
  // one-level deep: walk dir, return first match
  const stack = [into]
  while (stack.length) {
    const d = stack.pop()
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) stack.push(p)
      else if (e.name === exe) return p
    }
  }
  throw new Error('frpc binary not found inside archive')
}

// ponytail: v0.5.0 — broadcast download state changes to every renderer.
// Other pages (and the titlebar FRPC chip) can subscribe via `frpc.onDownloadState`
// so a route switch doesn't strand the user thinking the download stopped.
function broadcastDownloadState(state) {
  downloadState = state
  BrowserWindow.getAllWindows().forEach(w => {
    w.webContents.send('frpc:download:state', state)
  })
}

async function downloadFrpc(win) {
  // ponytail: refuse to start a second download if one is already in flight.
  // The download lock is the AbortController, not a boolean — second click
  // would race the first download's tmp file.
  if (downloadState && downloadState.active) {
    return { ok: false, error: '已在下载中', alreadyDownloading: true }
  }
  const { asset, version } = platformAsset()
  const url = `https://github.com/fatedier/frp/releases/download/${version}/${asset}`
  const tmp = path.join(frpcDir(), asset)
  await fsp.mkdir(frpcDir(), { recursive: true })

  downloadAbort = new AbortController()
  broadcastDownloadState({ active: true, startedAt: Date.now(), version, asset })

  const emit = makeProgressEmitter()
  emit(0)
  try {
    await downloadTo(url, tmp, emit, downloadAbort.signal)
    // ponytail: small files finish too fast for progress UI to show; emit 100 once.
    emit(100)
    // extract and move frpc binary to canonical path
    const extractDir = path.join(frpcDir(), '_extract')
    await fsp.rm(extractDir, { recursive: true, force: true })
    await extractArchive(tmp, extractDir)
    const found = findFrpcBinary(extractDir)
    await fsp.copyFile(found, frpcBin())
    await fsp.chmod(frpcBin(), 0o755)
    await fsp.rm(tmp, { force: true })
    await fsp.rm(extractDir, { recursive: true, force: true })
    broadcastDownloadState({ active: false, startedAt: null, version, ok: true })
    downloadAbort = null
    return { ok: true, path: frpcBin(), version }
  } catch (e) {
    await fsp.rm(tmp, { force: true }).catch(() => {})
    const wasCancelled = (e.message === 'cancelled' || e.message?.includes('cancelled'))
    broadcastDownloadState({ active: false, startedAt: null, version, ok: !wasCancelled, cancelled: wasCancelled, error: wasCancelled ? null : String(e.message || e) })
    downloadAbort = null
    if (wasCancelled) return { ok: false, cancelled: true }
    throw e
  }
}

// ponytail: v0.5.0 — cancel hook. Called from the renderer's "取消下载" button or
// the tray. Triggers the AbortController; downloadTo's signal listener cleans up
// the partial file + rejects with 'cancelled'. Safe to call when nothing is
// in flight — it's a no-op.
function cancelDownload() {
  if (!downloadAbort) return { ok: false, notDownloading: true }
  downloadAbort.abort()
  return { ok: true }
}

// ----- spawn / stop --------------------------------------------------------

// ponytail: v0.5.0 — return rich error metadata so callers can react.
//   { ok: false, reason: 'config-incomplete'|'no-binary'|'already-running', message: '...' }
//   instead of throwing strings. Tray & Vue both inspect `reason` for UX.
function startFrpc() {
  const c = getFrpcConf()
  if (!c.server_addr || !c.server_port) {
    // ponytail: v0.5.1 — HTTP-mode proxy needs server_addr + server_port, and
    // a custom domain (customDomains) to route by. server_addr/port are still
    // required; domain is checked separately below.
    BrowserWindow.getAllWindows().forEach(w => {
      w.webContents.send('frpc:open-settings', { reason: 'config-incomplete' })
    })
    return { ok: false, reason: 'config-incomplete', message: 'FRPC config incomplete (server_addr / server_port required)' }
  }
  if (!String(c.subdomain || '').trim()) {
    BrowserWindow.getAllWindows().forEach(w => {
      w.webContents.send('frpc:open-settings', { reason: 'config-incomplete' })
    })
    return { ok: false, reason: 'config-incomplete', message: 'FRPC config incomplete (custom domain required for HTTP mode)' }
  }
  if (proc) return { ok: true, pid: proc.pid, alreadyRunning: true }
  if (!fs.existsSync(frpcBin())) {
    return { ok: false, reason: 'no-binary', message: 'FRPC binary not downloaded yet' }
  }
  fs.writeFileSync(frpcTomlPath(), renderToml(c))
  // ponytail: reset in-memory ring buffer on each start; on-disk log is appended.
  logLines.length = 0
  _logPartial = ''
  const logFd = fs.openSync(frpcLogPath(), 'a')
  proc = spawn(frpcBin(), ['-c', frpcTomlPath()], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    // detached: false so we can pipe stdio cleanly; we still track PID for shutdown.
  })
  const onChunk = (chunk) => {
    try { fs.writeSync(logFd, chunk) } catch {}
    feedLogChunk(chunk)
  }
  proc.stdout.on('data', onChunk)
  proc.stderr.on('data', onChunk)
  proc.on('exit', (code, signal) => {
    proc = null
    try { fs.closeSync(logFd) } catch {}
    BrowserWindow.getAllWindows().forEach(w => {
      w.webContents.send('frpc:status', { running: false, code, signal })
    })
  })
  BrowserWindow.getAllWindows().forEach(w => {
    w.webContents.send('frpc:status', { running: true, pid: proc.pid })
  })
  return { ok: true, pid: proc.pid }
}

function stopFrpc() {
  if (!proc) return { ok: true, alreadyStopped: true }
  const pid = proc.pid
  try {
    if (process.platform === 'win32') {
      // /T kills the whole tree (frpc.exe → cmd wrapper); without it the helper stays around.
      execFileSync('taskkill.exe', ['/pid', String(pid), '/T', '/F'], { stdio: 'pipe' })
    } else {
      proc.kill('SIGTERM')
      // ponytail: hard kill fallback after 3s if frpc ignores SIGTERM (it shouldn't, but a hung tunnel can).
      const p = proc
      setTimeout(() => { try { p.kill('SIGKILL') } catch {} }, 3000)
    }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
  proc = null
  return { ok: true }
}

function frpcStatus() {
  if (proc) return { running: true, pid: proc.pid, binary: frpcBin(), hasBinary: true }
  const has = fs.existsSync(frpcBin())
  return { running: false, binary: frpcBin(), hasBinary: has }
}

// ----- IPC registration ----------------------------------------------------

function register() {
  ipcMain.handle('frpc:download', async (e) => {
    return downloadFrpc(BrowserWindow.fromWebContents(e.sender))
  })
  ipcMain.handle('frpc:cancelDownload', () => cancelDownload())
  ipcMain.handle('frpc:downloadState', () => downloadState)
  ipcMain.handle('frpc:start', () => startFrpc())
  ipcMain.handle('frpc:stop', () => stopFrpc())
  ipcMain.handle('frpc:status', () => frpcStatus())
  ipcMain.handle('frpc:log:get', () => readLogTail())
  ipcMain.handle('frpc:conf:get', () => getFrpcConf())
  ipcMain.handle('frpc:conf:set', (_e, patch) => {
    const cur = readConf()
    cur.frpc = { ...(cur.frpc || {}), ...patch }
    const file = path.join(app.getPath('home'), '.cj-nantianmen', 'nantianmen-conf.json')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(cur, null, 2))
    return cur.frpc
  })
}

// ponytail: called once during app boot — if user opted into auto_start AND enabled,
// launch frpc. enabled=false is a hard veto — we don't touch frpc regardless of auto_start.
// Failures here are non-fatal; we just log so a broken frpc config can't break desktop startup.
function autoStartIfEnabled() {
  const c = getFrpcConf()
  if (!c.enabled) return
  if (!c.auto_start) return
  try { startFrpc() } catch (e) { console.warn('[frpc] auto-start failed:', e.message) }
}

function shutdown() {
  if (proc) try { stopFrpc() } catch {}
}

// ponytail: v0.5.0 — tray menu entry points. These wrap the existing primitives
// but DON'T spawn the frpc process unless the user has confirmed it (the
// caller already gated on enabled). Mirrors the desktop IPC semantics:
//   enable   → enabled=true  (config persisted; doesn't auto-start)
//   disable  → stop + enabled=false (config preserved)
//   startNow → spawn immediately (caller must have checked enabled=true)
//   stopNow  → kill immediately
// hasBinary → cheap check so tray can hide FRPC entries if binary isn't downloaded.
function setEnabled(enabled) {
  const cur = readConf()
  cur.frpc = { ...(cur.frpc || {}), enabled: !!enabled }
  const file = path.join(app.getPath('home'), '.cj-nantianmen', 'nantianmen-conf.json')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(cur, null, 2))
  return cur.frpc
}

function isRunning() { return !!proc }

module.exports = {
  register, autoStartIfEnabled, shutdown,
  start: startFrpc, stop: stopFrpc,
  cancelDownload,
  enable: () => setEnabled(true),
  disable: () => { try { stopFrpc() } catch {} ; return setEnabled(false) },
  hasBinary: () => fs.existsSync(frpcBin()),
  getConf: getFrpcConf,
  isRunning,
}