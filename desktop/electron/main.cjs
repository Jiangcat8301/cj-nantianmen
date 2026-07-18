const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain } = require('electron')
const path = require('path')
const { fork } = require('child_process')
const http = require('http')
const fs = require('fs')

// ponytail: speed up Chromium cold start on Windows by skipping the GPU sandbox.
// Nantianmen is a UI tool, no GPU compositing needed.
if (process.platform === 'win32') {
  app.commandLine.appendSwitch('disable-gpu-sandbox')
}

let mainWindow
let tray = null
let serverProcess = null
const SERVER_PORT = 38271
const SERVER_URL = `http://127.0.0.1:${SERVER_PORT}`

// ponytail: window control IPC for frameless titlebar
ipcMain.on('win:minimize', () => mainWindow?.minimize())
ipcMain.on('win:maximize', () => {
  if (!mainWindow) return
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()
})
ipcMain.on('win:close', () => mainWindow?.close())
ipcMain.handle('win:isMaximized', () => mainWindow?.isMaximized() ?? false)

// ponytail: auto-start — uses Electron's setLoginItemSettings (cross-platform, Registry on Windows)
ipcMain.handle('autostart:get', () => {
  return app.getLoginItemSettings().openAtLogin
})
ipcMain.handle('autostart:set', (_e, enabled) => {
  app.setLoginItemSettings({ openAtLogin: !!enabled })
  return app.getLoginItemSettings().openAtLogin
})

// ponytail: server control IPC for Dashboard
ipcMain.handle('server:status', async () => {
  return { online: await checkServerHealth() }
})
ipcMain.handle('server:start', async () => {
  await startServer()
  return { online: await checkServerHealth() }
})
ipcMain.handle('server:stop', async () => {
  stopServer()
  await new Promise(r => setTimeout(r, 500))
  return { online: false }
})
ipcMain.handle('server:restart', async () => {
  stopServer()
  await new Promise(r => setTimeout(r, 500))
  await startServer()
  return { online: await checkServerHealth() }
})

function getIcon() {
  // ponytail: Windows taskbar + titlebar require an .ico file (multi-resolution).
  // PNG in BrowserWindow.icon silently fails → taskbar shows the default Electron icon.
  return path.join(__dirname, '..', 'nantianmen.ico')
}

function getServerPath() {
  // ponytail: bundled server path. In production it's in resources/server.
  // In dev it's ../server relative to desktop/
  const devPath = path.join(__dirname, '..', '..', 'server')
  const prodPath = path.join(process.resourcesPath, 'server')
  const chosen = fs.existsSync(devPath) ? devPath : prodPath
  console.log('[ntm] getServerPath: devPath=', devPath, 'prodPath=', prodPath, 'chosen=', chosen, 'existsDev=', fs.existsSync(devPath), 'existsProd=', fs.existsSync(prodPath))
  return chosen
}

async function checkServerHealth() {
  return new Promise((resolve) => {
    const req = http.get(`${SERVER_URL}/v1/health`, (res) => {
      res.resume()
      resolve(res.statusCode === 200)
    })
    req.on('error', () => resolve(false))
    req.setTimeout(2000, () => { req.destroy(); resolve(false) })
  })
}

async function startServer() {
  if (await checkServerHealth()) {
    console.log('Server already running')
    return
  }

  // ponytail: v0.2 - spawn Node.js server directly instead of Python uvicorn.
  // Bundled node_modules + index.js together with electron-builder extraResources.
  const serverPath = getServerPath()
  // ponytail: ELECTRON_RUN_AS_NODE=1 so fork() runs Node.js, not another Electron window.
  // NANTIANMEN_LOCAL_MODE=1 so server skips admin auth for its parent process.
  // ponytail: persistent user-data dir. Single subdir across all three launchers:
  //   Windows: %APPDATA%\Roaming\cj-nantianmen\
  //   macOS:   ~/Library/Application Support/cj-nantianmen/
  //   Linux:   ~/.config/cj-nantianmen/  (XDG)
  // Electron userData = appData + package.json#name (cj-nantianmen); matches conf.js defaultBaseDir.
  const dataDir = app.getPath('userData')
  try { fs.mkdirSync(dataDir, { recursive: true }) } catch {}
  const confPath = path.join(dataDir, 'nantianmen-conf.json')
  const dbPath = path.join(dataDir, 'nantianmen.db')
  const confEnv = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    NANTIANMEN_LOCAL_MODE: '1',
  }
  try {
    const serverEntry = path.join(serverPath, 'index.js')
    console.log('[ntm] forking:', serverEntry, 'cwd:', serverPath)
    serverProcess = fork(
      serverEntry,
      ['-c', confPath, '-D', dbPath],
      { cwd: serverPath, env: confEnv, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] },
    )
    console.log('[ntm] fork pid:', serverProcess?.pid)
  } catch (e) {
    console.error('[ntm] fork failed:', e)
    throw e
  }

  // ponytail: bubble spawn errors so .catch() in app.whenReady() surfaces them.
  serverProcess.on('error', (e) => console.error('[server] error:', e))

  serverProcess.stdout?.on('data', (d) => console.log(`[server] ${d}`))
  serverProcess.stderr?.on('data', (d) => console.error(`[server] ${d}`))
  serverProcess.on('exit', (code) => console.log(`[server] exited with ${code}`))

  for (let i = 0; i < 30; i++) {
    if (await checkServerHealth()) {
      console.log('Server started successfully')
      return
    }
    await new Promise(r => setTimeout(r, 500))
  }
  console.error('Server failed to start within 15s')
}

function stopServer() {
  if (serverProcess) {
    serverProcess.kill('SIGTERM')
    serverProcess = null
  }
}

let splashWindow = null

function createSplash() {
  splashWindow = new BrowserWindow({
    width: 300, height: 160,
    frame: false, transparent: true, alwaysOnTop: true,
    center: true, resizable: false,
    backgroundColor: '#00000000',
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  })
  // ponytail: inline splash HTML — no extra file, shows instantly before Electron extraction + Vue boot.
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    *{margin:0;padding:0} body{background:#0d1117;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:system-ui,-apple-system,sans-serif;border:1px solid #1f2937;border-radius:8px}
    .logo{font-size:36px;margin-bottom:8px} .title{font-size:16px;font-weight:700;color:#34d399;margin-bottom:4px}
    .sub{font-size:11px;color:#6b7280;margin-bottom:12px} .loader{width:120px;height:3px;background:#1f2937;border-radius:2px;overflow:hidden}
    .loader-bar{width:30%;height:100%;background:#34d399;border-radius:2px;animation:slide 1.2s ease-in-out infinite}
    @keyframes slide{0%{transform:translateX(-30%)}100%{transform:translateX(430%)}}
  </style></head><body><div class="logo">🚪</div><div class="title">南天门</div><div class="sub">Nantianmen · Starting…</div><div class="loader"><div class="loader-bar"></div></div></body></html>`
  splashWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  splashWindow.show()
}

// ponytail: persist window bounds via nantianmen-conf.json (shared with server).
// Replaces window-state.json — same physical file, no race in practice.
const confFile = path.join(app.getPath('userData'), 'nantianmen-conf.json')

function readConf() {
  try { if (fs.existsSync(confFile)) return JSON.parse(fs.readFileSync(confFile, 'utf-8')) } catch {}
  return {}
}

function saveConf(patch) {
  const c = readConf()
  Object.assign(c, patch)
  try { fs.writeFileSync(confFile, JSON.stringify(c, null, 2)) } catch {}
}

function saveWindowState() {
  if (!mainWindow) return
  const b = mainWindow.getBounds()
  saveConf({ window_state: { x: b.x, y: b.y, width: b.width, height: b.height, isMaximized: mainWindow.isMaximized() } })
}

function restoreWindowState() {
  const c = readConf()
  return c.window_state || null
}

async function createWindow() {
  const saved = restoreWindowState()
  mainWindow = new BrowserWindow({
    width: saved?.width || 1200,
    height: saved?.height || 800,
    x: saved?.x,
    y: saved?.y,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    show: false,
    backgroundColor: '#0d1117',
    icon: getIcon(),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  })

  if (saved?.isMaximized) mainWindow.maximize()

  // ponytail: close splash when main window is ready.
  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
    if (splashWindow) { splashWindow.close(); splashWindow = null }
  })

  // ponytail: minimize to tray instead of closing. Re-create only on app quit.
  mainWindow.on('close', (e) => {
    saveWindowState()
    if (!app.isQuitting) {
      e.preventDefault()
      mainWindow.hide()
    }
  })

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173')
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
}

app.whenReady().then(async () => {
  // ponytail: show splash instantly so user knows app is launching.
  createSplash()
  await createWindow()
  startServer().catch(e => console.error('Server start failed:', e))
  // System tray — use multi-resolution ICO (16/24/32/48/64/128/256) so Windows
  // picks the closest match to tray size (typically 16x16). PNG sometimes fails
  // to render in the tray on Windows because the shell expects ICO format.
  const iconDir = path.join(__dirname, '..')
  const trayIcon = nativeImage.createFromPath(path.join(iconDir, 'nantianmen.ico'))
  tray = new Tray(trayIcon)
  tray.setToolTip('Nantianmen LLM Proxy Gateway')

  let lastState = null
  async function updateTray() {
    let state = 'offline'
    try {
      const ok = await checkServerHealth()
      if (ok) {
        const resp = await new Promise((resolve) => {
          const req = http.get(`${SERVER_URL}/v1/health`, (r) => {
            let d = ''
            r.on('data', (c) => d += c)
            r.on('end', () => { try { resolve(JSON.parse(d)) } catch { resolve(null) } })
          })
          req.on('error', () => resolve(null))
          req.setTimeout(2000, () => { req.destroy(); resolve(null) })
        })
        if (resp && resp.active_requests > 0) state = 'active'
        else state = 'online'
      }
    } catch { state = 'offline' }

    if (state !== lastState) {
      const labels = { online: 'Online', offline: 'Offline', active: `Active (${resp?.active_requests || '?'})` }
      tray.setToolTip(`Nantianmen - ${labels[state]}`)
      lastState = state
      serverOnline = state !== 'offline'
      buildTrayMenu()
    }
  }

  // ponytail: poll every 3s
  setInterval(updateTray, 3000)
  setInterval(async () => { await fetchDailyStats(); buildTrayMenu() }, 15000)
  updateTray()
  fetchDailyStats()

  tray.on('click', () => {
    if (mainWindow) {
      mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show()
    }
  })
  // ponytail: dynamic tray menu with start/stop + daily stats + i18n
  let serverOnline = false
  let trayLang = 'zh'
  const trayLabels = {
    zh: { show: '显示窗口', hide: '隐藏窗口', start: '启动服务', stop: '停止服务', quit: '退出' },
    en: { show: 'Show', hide: 'Hide', start: 'Start Server', stop: 'Stop Server', quit: 'Quit' },
    ja: { show: '表示', hide: '隠す', start: '起動', stop: '停止', quit: '終了' },
  }
  ipcMain.handle('get-tray-lang', () => trayLang)
  ipcMain.on('set-tray-lang', (_e, lang) => { trayLang = lang; buildTrayMenu() })
  let dailyStats = { input: 0, output: 0, cached: 0, cost: 0 }
  async function fetchDailyStats() {
    try {
      const s = await new Promise((resolve) => {
        const req = http.get(`${SERVER_URL}/api/admin/stats?range=today`, (r) => {
          let d = ''
          r.on('data', (c) => d += c)
          r.on('end', () => { try { resolve(JSON.parse(d)) } catch { resolve(null) } })
        })
        req.on('error', () => resolve(null))
        req.setTimeout(3000, () => { req.destroy(); resolve(null) })
      })
      if (s) {
        dailyStats = {
          input: s.total_input_tokens || 0,
          output: s.total_output_tokens || 0,
          cached: s.total_cached_tokens || 0,
          cost: s.breakdown?.reduce((sum, r) => sum + ((r.input_tokens||0)*(r.input_price||0) + (r.output_tokens||0)*(r.output_price||0) + (r.cached_tokens||0)*(r.cache_hit_price||0)) / 1e6, 0) || 0,
        }
      }
    } catch {}
  }
  function fmtK(n) { if (n >= 1024*1024) return (n/(1024*1024)).toFixed(2)+'M'; if (n >= 1024) return (n/1024).toFixed(1)+'K'; return String(n) }
  function buildTrayMenu() {
    const s = dailyStats
    const L = trayLabels[trayLang] || trayLabels.zh
    const menu = [
      { label: L.show, click: () => mainWindow?.show() },
      { label: L.hide, click: () => mainWindow?.hide() },
      { type: 'separator' },
      { label: `📥 ${fmtK(s.input)}  📤 ${fmtK(s.output)}  💾 ${fmtK(s.cached)}  💰 $${s.cost.toFixed(3)}`, enabled: false },
      { type: 'separator' },
      { label: L.quit, click: () => app.quit() },
    ]
    tray.setContextMenu(Menu.buildFromTemplate(menu))
  }
  buildTrayMenu()
})

app.on('window-all-closed', () => {
  // ponytail: keep tray alive on all platforms; quit explicitly via tray menu
  if (process.platform !== 'darwin') {
    // On Windows/Linux, hide to tray instead of quitting
    if (tray) return
    app.quit()
  }
})

app.on('before-quit', () => {
  app.isQuitting = true
  stopServer()
})

app.on('activate', async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    await startServer()
    await createWindow()
  }
})
