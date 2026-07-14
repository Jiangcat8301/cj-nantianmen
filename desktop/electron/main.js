const { app, BrowserWindow, spawn } = require('electron')
const path = require('path')
const { spawn: spawnChild } = require('child_process')
const http = require('http')
const fs = require('fs')

let mainWindow
let serverProcess = null
const SERVER_PORT = 7300
const SERVER_URL = `http://127.0.0.1:${SERVER_PORT}`

function getServerPath() {
  // ponytail: bundled server path. In production it's in resources/server.
  // In dev it's ../server relative to desktop/
  const devPath = path.join(__dirname, '..', '..', 'server')
  const prodPath = path.join(process.resourcesPath, 'server')
  return fs.existsSync(devPath) ? devPath : prodPath
}

function getPythonPath() {
  // ponytail: find python. Check venv first, then system python.
  const serverPath = getServerPath()
  const venvPython = path.join(serverPath, '.venv', 'Scripts', 'python.exe')
  if (fs.existsSync(venvPython)) return venvPython
  const venvPythonUnix = path.join(serverPath, '.venv', 'bin', 'python')
  if (fs.existsSync(venvPythonUnix)) return venvPythonUnix
  return 'python3'
}

async function checkServerHealth() {
  return new Promise((resolve) => {
    const req = http.get(`${SERVER_URL}/v1/health`, (res) => {
      resolve(res.statusCode === 200)
    })
    req.on('error', () => resolve(false))
    req.setTimeout(2000, () => { req.destroy(); resolve(false) })
  })
}

async function startServer() {
  // Check if server already running (PID lock on server side handles this too)
  if (await checkServerHealth()) {
    console.log('Server already running')
    return
  }

  const serverPath = getServerPath()
  const pythonPath = getPythonPath()

  serverProcess = spawnChild(pythonPath, ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(SERVER_PORT)], {
    cwd: serverPath,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  serverProcess.stdout?.on('data', (d) => console.log(`[server] ${d}`))
  serverProcess.stderr?.on('data', (d) => console.error(`[server] ${d}`))
  serverProcess.on('exit', (code) => console.log(`[server] exited with ${code}`))

  // Wait for server to be ready
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
})

app.on('window-all-closed', () => {
  stopServer()
  if (process.platform !== 'darwin') app.quit()
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
