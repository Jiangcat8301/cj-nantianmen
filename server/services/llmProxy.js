import { getEntry, getModelMap } from './modelMap.js'
import { openaiReqToAnthropic, anthropicReqToOpenai, extractTokensOpenai, extractTokensAnthropic } from './protocol.js'
import * as stats from './stats.js'

export function resolveModel(modelField) {
  if (modelField === 'auto' || !modelField) {
    const map = getModelMap()
    const first = Object.values(map)[0]
    if (!first) throw new Error('No models configured')
    return first
  }
  const entry = getEntry(modelField)
  if (!entry) throw new Error(`Unknown model: ${modelField}`)
  return entry
}

export async function proxyRequest(body, inboundProtocol, apiKeyId) {
  const entry = resolveModel(body.model || 'auto')
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
  let captured = { input: 0, output: 0, cached: 0 }
  try {
    const resp = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(upstreamBody) })
    if (body.stream && resp.ok && resp.body) {
      return makeStreamingResponse(resp, providerProtocol, model_name, apiKeyId, provider.id)
    }
    if (!resp.ok) {
      const t = await resp.text()
      throw new Error(`Upstream ${resp.status}: ${t}`)
    }
    const data = await resp.json()
    captured = providerProtocol === 'openai' ? extractTokensOpenai(data.usage) : extractTokensAnthropic(data.usage)
    return data
  } finally {
    stats.release()
    if (captured.input || captured.output) {
      stats.record({ api_key_id: apiKeyId, provider_id: provider.id, model_name, request_count: 1, ...captured })
    }
  }
}

function makeStreamingResponse(resp, providerProtocol, model_name, apiKeyId, providerId) {
  // ponytail: pass-through for v0.2; cross-protocol SSE transform is TODO.
  const reader = resp.body.getReader()
  const dec = new TextDecoder()
  const queue = []
  let ended = false
  let lastErr = null
  let inputTokens = 0, outputTokens = 0, cachedTokens = 0

  const pump = (async () => {
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        const text = dec.decode(value, { stream: true })
        queue.push(text)
        // crude usage scrape; ponytail comment for upgrade
        const m = text.match(/"usage"\s*:\s*(\{[^}]+\})/)
        if (m) {
          try {
            const u = JSON.parse(m[1])
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
      }
    } catch (e) { lastErr = e }
    ended = true
    if (inputTokens || outputTokens) {
      stats.record({ api_key_id: apiKeyId, provider_id: providerId, model_name, request_count: 1, input_tokens: inputTokens, output_tokens: outputTokens, cached_tokens: cachedTokens })
    }
    stats.release()
  })()

  return {
    async *[Symbol.asyncIterator]() {
      let i = 0
      while (true) {
        if (queue[i] !== undefined) { yield queue[i++]; continue }
        if (ended) { if (lastErr) throw lastErr; return }
        await new Promise(r => setTimeout(r, 5))
      }
    },
  }
}
