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
})
