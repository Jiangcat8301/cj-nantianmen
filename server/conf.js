// nantianmen-conf.json: single source of truth, kept in memory after first load.
// Schema:
//   { initialized: bool,
//     server_host?: string,
//     server_port?: int,
//     salt?: string,        // 6 chars [A-Za-z0-9]
//     password?: string,    // md5(md5(RAWPASSWORD) + salt)
//     database?: { type: 'sqlite3'|'mysql', ...config } }
import fs from 'node:fs'
import path from 'node:path'

export const CONF_PATH = path.resolve('./nantianmen-conf.json')
export const DEFAULT_CONF = { initialized: false }

let _conf = null

export function loadConf() {
  if (fs.existsSync(CONF_PATH)) {
    _conf = JSON.parse(fs.readFileSync(CONF_PATH, 'utf8'))
  } else {
    _conf = { ...DEFAULT_CONF }
    saveConf()
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
  fs.writeFileSync(CONF_PATH, JSON.stringify(_conf, null, 2))
}

export function randomSalt() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let s = ''
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)]
  return s
}
