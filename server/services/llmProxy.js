import { getEntry, getDefaultEntry } from './modelMap.js'
import { openaiReqToAnthropic, anthropicReqToOpenai, extractTokensOpenai, extractTokensAnthropic } from './protocol.js'
import * as stats from './stats.js'

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

export async function proxyRequest(body, inboundProtocol, apiKeyId, reply) {
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
  let captured = { input_tokens: 0, output_tokens: 0, cached_tokens: 0 }
  try {
    const resp = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(upstreamBody) })
    if (body.stream && resp.ok && resp.body) {
      return makeStreamingResponse(resp, providerProtocol, model_name, apiKeyId, provider.id, reply)
    }
    if (!resp.ok) {
      const t = await resp.text()
      throw new Error(`Upstream ${resp.status}: ${t}`)
    }
    const data = await resp.json()
    captured = providerProtocol === 'openai' ? extractTokensOpenai(data.usage) : extractTokensAnthropic(data.usage)
    return data
  } finally {
    // ponytail: streaming path handles release+record inside makeStreamingResponse
    if (!body.stream) {
      stats.release()
      if (captured.input_tokens || captured.output_tokens) {
        stats.record({ api_key_id: apiKeyId, provider_id: provider.id, model_name, request_count: 1, ...captured })
      }
    }
  }
}

function makeStreamingResponse(resp, providerProtocol, model_name, apiKeyId, providerId, reply) {
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  })

  const reader = resp.body.getReader()
  const dec = new TextDecoder()
  let inputTokens = 0, outputTokens = 0, cachedTokens = 0

  ;(async () => {
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        const text = dec.decode(value, { stream: true })
        reply.raw.write(text)
        // ponytail: brace-counting parser — handles nested objects like prompt_tokens_details.
        // Previous regex /\{[^}]+\}/ broke on deepseek usage format.
        const ui = text.indexOf('"usage"')
        if (ui !== -1) {
          // ponytail: skip "usage":null (doubao-style streaming — no token counts in SSE)
          const after = text.slice(ui + 7).trimStart()
          if (after.startsWith(':null') || after.startsWith(': null')) continue
          const start = text.indexOf('{', ui)
          if (start !== -1) {
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
        }
      }
    } catch (e) {
      reply.raw.destroy(e)
      return
    }
    reply.raw.end()
    // ponytail: always record request_count even if provider didn't send usage in SSE
    stats.record({ api_key_id: apiKeyId, provider_id: providerId, model_name, request_count: 1, input_tokens: inputTokens, output_tokens: outputTokens, cached_tokens: cachedTokens })
    stats.release()
  })()
}
