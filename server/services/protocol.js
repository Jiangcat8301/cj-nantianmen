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

// ponytail: non-streaming response format converters.
// Anthropic Messages API → OpenAI chat.completion shape.

export function anthropicRespToOpenAI(data) {
  const text = (data.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n')
  const finishReason = data.stop_reason === 'end_turn' ? 'stop' : (data.stop_reason || 'stop')
  return {
    id: data.id || '',
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: data.model || '',
    choices: [{
      index: 0,
      message: { role: 'assistant', content: text },
      finish_reason: finishReason,
    }],
    usage: data.usage ? {
      prompt_tokens: data.usage.input_tokens || 0,
      completion_tokens: data.usage.output_tokens || 0,
      total_tokens: (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0),
    } : undefined,
  }
}

// OpenAI chat.completion → Anthropic Messages API shape.
export function openaiRespToAnthropic(data) {
  const choice = (data.choices || [])[0]
  const msg = choice?.message || {}
  return {
    id: data.id || '',
    type: 'message',
    role: 'assistant',
    model: data.model || '',
    content: [{ type: 'text', text: msg.content || '' }],
    stop_reason: choice?.finish_reason === 'stop' ? 'end_turn' : (choice?.finish_reason || 'end_turn'),
    usage: data.usage ? {
      input_tokens: data.usage.prompt_tokens || 0,
      output_tokens: data.usage.completion_tokens || 0,
    } : undefined,
  }
}

export function extractTokensOpenai(usage) {
  return {
    input_tokens: usage?.prompt_tokens ?? 0,
    output_tokens: usage?.completion_tokens ?? 0,
    cached_tokens: usage?.prompt_tokens_details?.cached_tokens ?? 0,
  }
}

export function extractTokensAnthropic(usage) {
  return {
    input_tokens: usage?.input_tokens ?? 0,
    output_tokens: usage?.output_tokens ?? 0,
    cached_tokens: (usage?.cache_read_input_tokens ?? 0) + (usage?.cache_creation_input_tokens ?? 0),
  }
}
