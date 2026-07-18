import { getEntry, getDefaultEntry } from './modelMap.js'
import { openaiReqToAnthropic, anthropicReqToOpenai, anthropicRespToOpenAI, openaiRespToAnthropic, anthropicSSEToOpenAI, extractTokensOpenai, extractTokensAnthropic } from './protocol.js'
import * as stats from './stats.js'
import * as commlog from './commlog.js'
import { getDb } from '../db/index.js'
import { getDispatcher } from './proxyDispatcher.js'
import crypto from 'node:crypto'

function nowStr() {
  const d = new Date()
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0') + ' ' +
    String(d.getHours()).padStart(2, '0') + ':' +
    String(d.getMinutes()).padStart(2, '0') + ':' +
    String(d.getSeconds()).padStart(2, '0')
}

// ponytail: lookup user_name once per log entry.
async function getUserName(apiKeyId) {
  if (!apiKeyId) return ''
  try {
    const r = await getDb().query('SELECT name FROM api_keys WHERE id=?', [apiKeyId])
    return r[0]?.name || ''
  } catch { return '' }
}

// ponytail: extract functions return snake_case (matches stats.record), streaming
// passes camelCase shorthand. Normalize here so both callers just work.
async function logEntry({ apiKeyId, provider, modelName, upstreamBody, responseBody, inputTokens, outputTokens, cachedTokens, error, durationMs, input_tokens, output_tokens, cached_tokens, duration_ms }) {
  inputTokens = inputTokens ?? input_tokens ?? 0
  outputTokens = outputTokens ?? output_tokens ?? 0
  cachedTokens = cachedTokens ?? cached_tokens ?? 0
  const finalDurationMs = durationMs ?? duration_ms ?? null
  const user_name = await getUserName(apiKeyId)
  commlog.append({
    request_id: crypto.randomUUID(),
    time: nowStr(),
    user_id: apiKeyId || '',
    user_name,
    provider_id: provider.id,
    provider_name: provider.name,
    model_name: modelName,
    tokens_input: inputTokens || 0,
    tokens_output: outputTokens || 0,
    tokens_cached: cachedTokens || 0,
    duration_ms: finalDurationMs,
    input: JSON.stringify(upstreamBody),
    output: responseBody || '',
    ...(error ? { error } : {}),
  })
}

export function resolveModel(modelField) {
  if (modelField === 'auto' || modelField === 'Nantianmen-default' || !modelField) {
    const entry = getDefaultEntry()
    if (!entry) throw new Error('No models configured')
    return entry
  }
  const entry = getEntry(modelField)
  if (!entry) throw new Error(`Unknown model: ${modelField}`)
  return entry
}

// ponytail: per-key model override — when api_keys.assigned_model is set,
// every request from this key uses that model regardless of what the
// caller puts in `body.model`. Endpoint and the /v1/models list are NOT
// modified; only the resolved entry is swapped at request time.
async function getAssignedEntry(apiKeyId) {
  if (!apiKeyId) return null
  try {
    const rows = await getDb().query('SELECT assigned_model FROM api_keys WHERE id=?', [apiKeyId])
    const v = rows[0]?.assigned_model
    if (!v) return null
    return getEntry(v) || null  // returns null if assigned_model points to a deleted/disabled model
  } catch { return null }
}

export async function proxyRequest(body, inboundProtocol, apiKeyId, reply) {
  const overrideEntry = await getAssignedEntry(apiKeyId)
  const entry = overrideEntry || resolveModel(body.model || 'auto')
  const { provider, model_name, protocol: providerProtocol, endpoint, headers } = entry
  let upstreamBody
  if (inboundProtocol === providerProtocol) {
    upstreamBody = { ...body, model: model_name }
  } else if (inboundProtocol === 'openai' && providerProtocol === 'anthropic') {
    upstreamBody = { ...openaiReqToAnthropic(body), model: model_name }
  } else if (inboundProtocol === 'anthropic' && providerProtocol === 'openai') {
    upstreamBody = { ...anthropicReqToOpenai(body), model: model_name }
  } else {
    throw new Error(`Unsupported protocol pair: ${inboundProtocol} -> ${providerProtocol}`)
  }

  stats.acquire()
  let captured = { input_tokens: 0, output_tokens: 0, cached_tokens: 0 }
  try {
    // ponytail: TTFB — from fetch() call to upstream response headers received.
    const t0 = Date.now()
    const resp = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(upstreamBody), dispatcher: await getDispatcher() })
    const durationMs = Date.now() - t0
    if (body.stream && resp.ok && resp.body) {
      return makeStreamingResponse(resp, inboundProtocol, providerProtocol, model_name, apiKeyId, provider.id, reply, upstreamBody, provider, durationMs)
    }
    if (!resp.ok) {
      const t = await resp.text()
      await logEntry({ apiKeyId, provider, modelName: model_name, upstreamBody, responseBody: t, inputTokens: 0, outputTokens: 0, cachedTokens: 0, durationMs, error: { code: resp.status, message: t } })
      throw new Error(`Upstream ${resp.status}: ${t}`)
    }
    const data = await resp.json()
    captured = providerProtocol === 'openai' ? extractTokensOpenai(data.usage) : extractTokensAnthropic(data.usage)
    // ponytail: convert response format when protocols differ
    let out = data
    if (inboundProtocol === 'openai' && providerProtocol === 'anthropic') {
      out = anthropicRespToOpenAI(data, provider.name || '')
    } else if (inboundProtocol === 'anthropic' && providerProtocol === 'openai') {
      out = openaiRespToAnthropic(data)
    }
    await logEntry({ apiKeyId, provider, modelName: model_name, upstreamBody, responseBody: JSON.stringify(out), durationMs, ...captured })
    return out
  } catch (e) {
    if (!e.message?.startsWith('Upstream ')) {
      await logEntry({ apiKeyId, provider, modelName: model_name, upstreamBody, responseBody: '', inputTokens: 0, outputTokens: 0, cachedTokens: 0, durationMs: Date.now() - t0, error: { code: 0, message: e.message } })
    }
    throw e
  } finally {
    if (!body.stream) {
      stats.release()
      if (captured.input_tokens || captured.output_tokens) {
        stats.record({ api_key_id: apiKeyId, provider_id: provider.id, model_name, request_count: 1, ...captured })
      }
    }
  }
}

function makeStreamingResponse(resp, inboundProtocol, providerProtocol, model_name, apiKeyId, providerId, reply, upstreamBody, provider, ttfbMs) {
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  })

  const reader = resp.body.getReader()
  const dec = new TextDecoder()
  let inputTokens = 0, outputTokens = 0, cachedTokens = 0
  let outputBuf = ''
  const needConvert = inboundProtocol === 'openai' && providerProtocol === 'anthropic'
  const sseBuf = { s: '', doneSent: false }
  const msgId = { v: '' }
  const toolBlockByIndex = {}  // ponytail: track which content_block indices are tool calls

  // ponytail: extract token counts from raw upstream SSE text (before conversion)
  function parseTokens(text) {
    const ui = text.indexOf('"usage"')
    if (ui === -1) return
    const after = text.slice(ui + 7).trimStart()
    if (after.startsWith(':null') || after.startsWith(': null')) return
    const start = text.indexOf('{', ui)
    if (start === -1) return
    let depth = 0, end = start
    for (; end < text.length; end++) {
      if (text[end] === '{') depth++
      else if (text[end] === '}') { depth--; if (depth === 0) break }
    }
    try {
      const u = JSON.parse(text.slice(start, end + 1))
      if (providerProtocol === 'openai') {
        inputTokens = u.prompt_tokens ?? inputTokens
        outputTokens = u.completion_tokens ?? outputTokens
        cachedTokens = u.prompt_tokens_details?.cached_tokens ?? cachedTokens
      } else {
        inputTokens = u.input_tokens ?? inputTokens
        outputTokens = u.output_tokens ?? outputTokens
        cachedTokens = (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
      }
    } catch {}
  }

  ;(async () => {
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        const text = dec.decode(value, { stream: true })
        outputBuf += text
        parseTokens(text)
        if (needConvert) {
          const converted = anthropicSSEToOpenAI(text, sseBuf, msgId, toolBlockByIndex)
          if (converted) reply.raw.write(converted)
        } else {
          reply.raw.write(text)
        }
      }
    } catch (e) {
      outputBuf += '\n[stop]'
      await logEntry({ apiKeyId, provider, modelName: model_name, upstreamBody, responseBody: outputBuf, inputTokens, outputTokens, cachedTokens, durationMs: ttfbMs, error: { code: 0, message: e.message } })
      reply.raw.destroy(e)
      return
    }
    // ponytail: flush remaining buffer
    if (needConvert && sseBuf.s.trim()) {
      if (!sseBuf.doneSent) reply.raw.write('data: [DONE]\n\n')
    }
    outputBuf += '\n[stop]'
    reply.raw.end()
    stats.record({ api_key_id: apiKeyId, provider_id: providerId, model_name, request_count: 1, input_tokens: inputTokens, output_tokens: outputTokens, cached_tokens: cachedTokens })
    stats.release()
    await logEntry({ apiKeyId, provider, modelName: model_name, upstreamBody, responseBody: outputBuf, inputTokens, outputTokens, cachedTokens, durationMs: ttfbMs })
  })()
}
