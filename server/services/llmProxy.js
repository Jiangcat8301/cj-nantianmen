import { getEntry, getDefaultEntry, resolveEntryFor } from './modelMap.js'
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
async function logEntry({ apiKeyId, provider, modelName, modelId, upstreamBody, responseBody, inputTokens, outputTokens, cachedTokens, error, durationMs, input_tokens, output_tokens, cached_tokens, duration_ms }) {
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
    model_id: modelId || null,
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

// ponytail: v0.2.14 — single entry resolver used by both proxyRequest and the auth-check hook.
// resolveEntryFor() in modelMap.js owns the rules; proxyRequest must use the same one to avoid drift.

// ponytail: per-key model override — when api_keys.assigned_model_id is set,
// every request from this key uses that model regardless of what the
// caller puts in `body.model`. Endpoint and the /v1/models list are NOT
// modified; only the resolved entry is swapped at request time.
async function getAssignedEntry(apiKeyId) {
  if (!apiKeyId) return null
  try {
    const rows = await getDb().query('SELECT assigned_model_id FROM api_keys WHERE id=?', [apiKeyId])
    const id = rows[0]?.assigned_model_id
    return id ? resolveEntryFor({ assignedModelId: id, bodyModel: null }) : null
  } catch { return null }
}

export async function proxyRequest(body, inboundProtocol, apiKeyId, reply) {
  const overrideEntry = await getAssignedEntry(apiKeyId)
  const entry = overrideEntry || resolveModel(body.model || 'auto')
  const { __modelId, provider, model_name, protocol: providerProtocol, endpoint, headers } = entry
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
      return makeStreamingResponse(resp, inboundProtocol, providerProtocol, model_name, __modelId, apiKeyId, provider.id, reply, upstreamBody, provider, durationMs)
    }
    if (!resp.ok) {
      const t = await resp.text()
      await logEntry({ apiKeyId, provider, modelName: model_name, modelId: __modelId, upstreamBody, responseBody: t, inputTokens: 0, outputTokens: 0, cachedTokens: 0, durationMs, error: { code: resp.status, message: t } })
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
    await logEntry({ apiKeyId, provider, modelName: model_name, modelId: __modelId, upstreamBody, responseBody: JSON.stringify(out), durationMs, ...captured })
    return out
  } catch (e) {
    if (!e.message?.startsWith('Upstream ')) {
      await logEntry({ apiKeyId, provider, modelName: model_name, modelId: __modelId, upstreamBody, responseBody: '', inputTokens: 0, outputTokens: 0, cachedTokens: 0, durationMs: Date.now() - t0, error: { code: 0, message: e.message } })
    }
    throw e
  } finally {
    if (!body.stream) {
      stats.release()
      if (captured.input_tokens || captured.output_tokens) {
        stats.record({ api_key_id: apiKeyId, provider_id: provider.id, model_id: __modelId, model_name, request_count: 1, ...captured })
      }
    }
  }
}

function makeStreamingResponse(resp, inboundProtocol, providerProtocol, model_name, modelId, apiKeyId, providerId, reply, upstreamBody, provider, ttfbMs) {
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
      await logEntry({ apiKeyId, provider, modelName: model_name, modelId, upstreamBody, responseBody: outputBuf, inputTokens, outputTokens, cachedTokens, durationMs: ttfbMs, error: { code: 0, message: e.message } })
      reply.raw.destroy(e)
      return
    }
    // ponytail: flush remaining buffer
    if (needConvert && sseBuf.s.trim()) {
      if (!sseBuf.doneSent) reply.raw.write('data: [DONE]\n\n')
    }
    outputBuf += '\n[stop]'
    reply.raw.end()
    stats.record({ api_key_id: apiKeyId, provider_id: providerId, model_id: modelId, model_name, request_count: 1, input_tokens: inputTokens, output_tokens: outputTokens, cached_tokens: cachedTokens })
    stats.release()
    await logEntry({ apiKeyId, provider, modelName: model_name, modelId, upstreamBody, responseBody: outputBuf, inputTokens, outputTokens, cachedTokens, durationMs: ttfbMs })
  })()
}

// ponytail: v0.3.15 — /v1/embeddings proxy. OpenAI-format only, body-whitelist, no stream, no override.
// assigned_model_id is chat-only (蒋老师 2026-07-20 拍板); body.model must be explicit. Anthropic protocol = 400.
// 计费只算 input_tokens (prompt_tokens); commlog output 仅记元数据，向量本体不落库 (避免 1024-dim × N 次调用撑爆 DB)。
// v0.2.14 增补: embedding 调用同样记 stats.record(req_count=1) + logEntry(input=原始 input, output=metadata)。
// 只统计调用次数,不计 token/cost;向量本体永不落库。
const EMBED_WHITELIST = new Set(['model', 'input', 'encoding_format', 'dimensions', 'user'])

export async function proxyEmbeddingRequest(body, apiKeyId, reply) {
  // (I-5) auto/Nantikanmen-default are chat-only virtual ids
  if (!body?.model || body.model === 'auto' || body.model === 'Nantianmen-default') {
    return reply.code(400).send({ error: '/v1/embeddings requires explicit model (no auto, no default)' })
  }
  // ponytail: 不走 assigned_model_id override — 蒋老师拍板 override 只影响 chat
  const entry = resolveModel(body.model)
  if (entry.capability !== 'embedding') {
    return reply.code(400).send({ error: `model '${body.model}' is not an embedding model` })
  }
  // (I-2) Anthropic has no public embeddings API
  if (entry.provider.protocol !== 'openai') {
    return reply.code(400).send({ error: 'embedding only supports openai protocol' })
  }
  // (I-3) whitelist body fields — clients sending extras get upstream 400, predictable behavior
  const upstreamBody = { model: entry.model_name }
  for (const k of EMBED_WHITELIST) if (k !== 'model' && body[k] !== undefined) upstreamBody[k] = body[k]

  // ponytail: 保留 agent 发送的真实 input, 用于 commlog 入参展示。
  // 不序列化整 upstreamBody (model 字段会被改写为 entry.model_name, 不是用户传的值)。
  const originalInput = body.input
  // metadata: 描述请求结构 + 向量维度,用于 output 栏快速识别,不暴露向量本体。
  const arrayLen = Array.isArray(originalInput) ? originalInput.length : (typeof originalInput === 'string' ? 1 : 0)

  stats.acquire()
  const t0 = Date.now()
  // ponytail: 一个标记位,确保 acquire 一定对应一次 release,无论哪条路径抛异常都不会下溢。
  let released = false
  const safeRelease = () => { if (!released) { released = true; stats.release() } }
  try {
    const resp = await fetch(entry.endpoint, {
      method: 'POST',
      headers: entry.headers,
      body: JSON.stringify(upstreamBody),
      dispatcher: await getDispatcher(),
    })
    const durationMs = Date.now() - t0
    if (!resp.ok) {
      const t = await resp.text()
      const errMsg = `Upstream ${resp.status}: ${t}`
      // 失败也要记一次 stats + logEntry,失败计数同样有意义(蒋老师 2026-08-01 拍板:调用次数要计)。
      stats.record({
        api_key_id: apiKeyId, provider_id: entry.provider.id,
        model_id: entry.__modelId, model_name: entry.model_name,
        request_count: 1, input_tokens: 0, output_tokens: 0, cached_tokens: 0,
      })
      safeRelease()
      await logEntry({
        apiKeyId, provider: entry.provider, modelName: entry.model_name, modelId: entry.__modelId,
        upstreamBody: { model: entry.model_name, input_count: arrayLen, encoding_format: upstreamBody.encoding_format || null },
        responseBody: '',
        inputTokens: 0, outputTokens: 0, cachedTokens: 0, durationMs,
        error: { code: resp.status, message: errMsg.slice(0, 500) },
      })
      throw new Error(errMsg)
    }
    const json = await resp.json()
    // ponytail: 取首条 embedding 维度,作为 metadata.embedding_dim。完整 768-dim 数组不落库。
    const dim = Array.isArray(json?.data?.[0]?.embedding) ? json.data[0].embedding.length : 0
    const usage = json?.usage || {}
    // 成功路径:记一次 stats + logEntry。token=0 (embedding 调用本身不计 token),但 req_count=1 必须计。
    stats.record({
      api_key_id: apiKeyId, provider_id: entry.provider.id,
      model_id: entry.__modelId, model_name: entry.model_name,
      request_count: 1, input_tokens: 0, output_tokens: 0, cached_tokens: 0,
    })
    safeRelease()
    await logEntry({
      apiKeyId, provider: entry.provider, modelName: entry.model_name, modelId: entry.__modelId,
      // input = agent 发送的真实 input(JSON 字符串 / 字符串数组 / 数组)
      upstreamBody: typeof originalInput === 'string' ? originalInput : JSON.stringify(originalInput),
      // output = metadata (维度 + 用量 + 模型);向量本体不写
      responseBody: JSON.stringify({
        embedding_dim: dim, embedding_count: Array.isArray(json?.data) ? json.data.length : 0,
        model: json?.model || entry.model_name, usage,
      }),
      inputTokens: 0, outputTokens: 0, cachedTokens: 0, durationMs,
    })
    return json
  } catch (e) {
    throw e
  } finally {
    safeRelease()
  }
}
