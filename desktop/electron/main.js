const { app, BrowserWindow, Tray, Menu, nativeImage } = require('electron')
const path = require('path')
const { fork } = require('child_process')
const http = require('http')
const fs = require('fs')

let mainWindow
let tray = null
let serverProcess = null
const SERVER_PORT = 38271
const SERVER_URL = `http://127.0.0.1:${SERVER_PORT}`

function getIcon() {
  // ponytail: .ico on Windows, .png on macOS/Linux
  if (process.platform === 'win32') {
    return path.join(__dirname, '..', 'nantianmen.ico')
  }
  return path.join(__dirname, '..', 'nantianmen-logo.png')
}

function getServerPath() {
  // ponytail: bundled server path. In production it's in resources/server.
  // In dev it's ../server relative to desktop/
  const devPath = path.join(__dirname, '..', '..', 'server')
  const prodPath = path.join(process.resourcesPath, 'server')
  return fs.existsSync(devPath) ? devPath : prodPath
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

  // ponytail: v0.2 — spawn Node.js server directly instead of Python uvicorn.
  // Bundled node_modules + index.js together with electron-builder extraResources.
  const serverPath = getServerPath()
  serverProcess = fork(path.join(serverPath, 'index.js'), [], {
    cwd: serverPath,
    env: { ...process.env, ELECTRON_HOST: '1' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })

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

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    icon: getIcon(),
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  })

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173')
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
}

app.whenReady().then(async () => {
  await startServer()
  await createWindow()

  // System tray with status overlay
  const iconDir = path.join(__dirname, '..')
  const icons = {
    online: nativeImage.createFromPath(path.join(iconDir, 'tray-online.png')),
    offline: nativeImage.createFromPath(path.join(iconDir, 'tray-offline.png')),
    active: nativeImage.createFromPath(path.join(iconDir, 'tray-active.png')),
  }
  tray = new Tray(icons.offline)
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
      tray.setImage(icons[state])
      const labels = { online: 'Online', offline: 'Offline', active: `Active (${resp?.active_requests || '?'})` }
      tray.setToolTip(`Nantianmen - ${labels[state]}`)
      lastState = state
    }
  }

  // ponytail: poll every 3s
  setInterval(updateTray, 3000)
  updateTray()

  tray.on('click', () => {
    if (mainWindow) {
      mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show()
    }
  })
  const ctxMenu = Menu.buildFromTemplate([
    { label: 'Show', click: () => mainWindow?.show() },
    { label: 'Hide', click: () => mainWindow?.hide() },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ])
  tray.setContextMenu(ctxMenu)
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
  stopServer()
})

app.on('activate', async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    await startServer()
    await createWindow()
  }
})
