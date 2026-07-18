// ponytail: outbound proxy dispatcher based on conf.proxy + conf.proxy_url.
//   'system' → use env HTTPS_PROXY/ALL_PROXY (Node's default behavior — no dispatcher)
//   'direct' → bypass any system proxy by routing to an explicit env override
//   'custom' → user-provided proxy_url (http(s):// or socks5://)
//
// We use undici (built into Node 18+), but the module may not be resolvable
// in an Electron-embedded server. Fall back to null dispatcher silently so the
// server can still start; proxy mode is a power-user feature.

// moved import from static top-level to dynamic inside a lazy load block
let _loaded = false
let ProxyAgent = null
let Agent = null

async function ensureUndici() {
  if (_loaded) return
  _loaded = true
  try {
    const u = await import('undici')
    ProxyAgent = u.ProxyAgent
    Agent = u.Agent
  } catch {
    // Electron-embedded server can't resolve 'undici' from asar
  }
}

import { getConf } from '../conf.js'

let _cachedKey = ''
let _cachedDispatcher = null

function makeDirectDispatcher() {
  if (!Agent) return null
  return new Agent({ connect: { proxy: false } })
}

function makeCustomDispatcher(url) {
  if (!url || typeof url !== 'string' || !ProxyAgent) return null
  return new ProxyAgent({ uri: url, connect: { timeout: 10000 } })
}

export async function getDispatcher() {
  await ensureUndici()
  const conf = getConf()
  const mode = conf.proxy || 'system'
  const url = conf.proxy_url || ''
  const key = `${mode}|${url}`
  if (key === _cachedKey && _cachedDispatcher !== undefined) return _cachedDispatcher
  let d = undefined
  if (mode === 'direct') d = makeDirectDispatcher()
  else if (mode === 'custom') d = makeCustomDispatcher(url)
  // 'system' or when undici isn't available: undefined disaptcher = fetch default
  _cachedKey = key
  _cachedDispatcher = d
  return d
}

export function resetDispatcherCache() { _cachedKey = ''; _cachedDispatcher = undefined }