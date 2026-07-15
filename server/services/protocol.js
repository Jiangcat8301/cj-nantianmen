// 4-path protocol conversion: openai <-> anthropic, passthrough.
// ponytail: stubs only — route handlers cover the basics; openai<->anthropic
// for a real deployment needs request shape mapping (messages<->contents,
// system, max_tokens, tools). Expand when first real cross-protocol request
// arrives.

export function openaiReqToAnthropic(body) {
  const out = { model: body.model, messages: [] }
  if (body.messages) {
    let sys = null
    const msgs = []
    for (const m of body.messages) {
      if (m.role === 'system') { sys = (sys ? sys + '\n' : '') + m.content; continue }
      msgs.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })
    }
    if (sys) out.system = sys
    out.messages = msgs
  }
  if (body.max_tokens) out.max_tokens = body.max_tokens
  if (body.temperature !== undefined) out.temperature = body.temperature
  if (body.stream) out.stream = body.stream
  return out
}

export function anthropicReqToOpenai(body) {
  const out = { model: body.model, messages: [] }
  if (body.system) out.messages.push({ role: 'system', content: body.system })
  if (body.messages) {
    for (const m of body.messages) {
      out.messages.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) })
    }
  }
  if (body.max_tokens) out.max_tokens = body.max_tokens
  if (body.temperature !== undefined) out.temperature = body.temperature
  if (body.stream) out.stream = body.stream
  return out
}

// ponytail: response shaping is inlined in llmProxy for v0.2.

export function extractTokensOpenai(usage) {
  return {
    input: usage?.prompt_tokens ?? 0,
    output: usage?.completion_tokens ?? 0,
    cached: usage?.prompt_tokens_details?.cached_tokens ?? 0,
  }
}

export function extractTokensAnthropic(usage) {
  return {
    input: usage?.input_tokens ?? 0,
    output: usage?.output_tokens ?? 0,
    cached: (usage?.cache_read_input_tokens ?? 0) + (usage?.cache_creation_input_tokens ?? 0),
  }
}
