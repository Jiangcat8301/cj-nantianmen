const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('win', {
  minimize: () => ipcRenderer.send('win:minimize'),
  toggleMaximize: () => ipcRenderer.send('win:maximize'),
  close: () => ipcRenderer.send('win:close'),
  isMaximized: () => ipcRenderer.invoke('win:isMaximized'),
  // server control
  serverStatus: () => ipcRenderer.invoke('server:status'),
  serverStart: () => ipcRenderer.invoke('server:start'),
  serverStop: () => ipcRenderer.invoke('server:stop'),
  serverRestart: () => ipcRenderer.invoke('server:restart'),
  // tray language
  getTrayLang: () => ipcRenderer.invoke('get-tray-lang'),
  setTrayLang: (lang) => ipcRenderer.send('set-tray-lang', lang),
  // auto-start
  autostartGet: () => ipcRenderer.invoke('autostart:get'),
  autostartSet: (enabled) => ipcRenderer.invoke('autostart:set', enabled),
  // push stats from data panel to tray
  updateTrayStats: (s) => ipcRenderer.send('update-tray-stats', s),
  // ponytail: v0.5.0 — FRPC reverse-proxy bridge
  frpc: {
    download: () => ipcRenderer.invoke('frpc:download'),
    cancelDownload: () => ipcRenderer.invoke('frpc:cancelDownload'),
    downloadState: () => ipcRenderer.invoke('frpc:downloadState'),
    start:    () => ipcRenderer.invoke('frpc:start'),
    stop:     () => ipcRenderer.invoke('frpc:stop'),
    status:   () => ipcRenderer.invoke('frpc:status'),
    getLog:   () => ipcRenderer.invoke('frpc:log:get'),
    getConf:  () => ipcRenderer.invoke('frpc:conf:get'),
    setConf:  (patch) => ipcRenderer.invoke('frpc:conf:set', patch),
    onProgress: (cb) => ipcRenderer.on('frpc:download:progress', (_e, p) => cb(p)),
    onDownloadState: (cb) => ipcRenderer.on('frpc:download:state', (_e, s) => cb(s)),
    onStatus:   (cb) => ipcRenderer.on('frpc:status', (_e, s) => cb(s)),
    onOpenSettings: (cb) => ipcRenderer.on('frpc:open-settings', (_e, s) => cb(s)),
  },
})
