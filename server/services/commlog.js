// ponytail: simple JSON append log, trim to 1000. Single file, no DB.
import fs from 'node:fs'
import path from 'node:path'
import { getConfDir, getConf } from '../conf.js'

const MAX = 1000

function logPath() { return path.join(getConfDir(), 'communication_log.json') }

function readAll() {
  try {
    if (fs.existsSync(logPath())) return JSON.parse(fs.readFileSync(logPath(), 'utf-8'))
  } catch {}
  return []
}

export function append(entry) {
  if (!getConf().log_enabled) return
  const logs = readAll()
  // ponytail: shift-trim — oldest goes first, newest appended
  while (logs.length >= MAX) logs.shift()
  logs.push(entry)
  try { fs.mkdirSync(path.dirname(logPath()), { recursive: true }) } catch {}
  fs.writeFileSync(logPath(), JSON.stringify(logs, null, 2))
}

export function list(filters = {}) {
  let logs = readAll()
  if (filters.provider_id) logs = logs.filter(l => String(l.provider_id) === String(filters.provider_id))
  if (filters.model_name) logs = logs.filter(l => l.model_name === filters.model_name)
  if (filters.user_id) logs = logs.filter(l => String(l.user_id) === String(filters.user_id))
  return logs
}

export function clear() {
  try { fs.writeFileSync(logPath(), '[]') } catch {}
}
