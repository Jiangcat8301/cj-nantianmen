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

// ponytail: Anthropic content block → OpenAI tool_calls entry.
// tool_use (custom client tools) → type:'function'
// server_tool_use (web_search, code_execution, etc.) → type:'custom'
function blockToToolCall(block) {
  if (block.type === 'tool_use') {
    return {
      id: block.id,
      type: 'function',
      function: { name: block.name, arguments: JSON.stringify(block.input) },
    }
  }
  if (block.type === 'server_tool_use') {
    return {
      id: block.id,
      type: 'custom',
      custom: { name: block.name, input: JSON.stringify(block.input) },
    }
  }
  return null
}

// ponytail: parse Minimax non-standard tool_call XML into OpenAI tool_calls
function parseMinimaxToolCalls(text) {
  const cleaned = text.replace(/<\]minimax\[>\[/g, '')
  const tcMatch = cleaned.match(/<tool_call>(.*?)<\/tool_call>/s)
  if (!tcMatch) return { cleanText: cleaned.trim() || null, toolCalls: [] }
  const toolCalls = []
  let callId = 0
  const invokeRe = /<invoke\s+name="([^"]+)">(.*?)<\/invoke>/gs
  let m
  while ((m = invokeRe.exec(tcMatch[1])) !== null) {
    const name = m[1]
    const body = m[2]
    const args = {}
    // extract <query>text</query> or <parameter name="k">v</parameter>
    const paramRe = /<(query|parameter)(?:\s+name="([^"]*)")?>(.*?)<\/\1>/gs
    let pm
    while ((pm = paramRe.exec(body)) !== null) {
      const key = pm[1] === 'parameter' ? (pm[2] || 'value') : 'query'
      args[key] = pm[3].trim()
    }
    toolCalls.push({
      id: `minimax_${++callId}`,
      type: 'function',
      function: { name, arguments: JSON.stringify(args) },
    })
  }
  const cleanText = cleaned.replace(/<tool_call>.*?<\/tool_call>/s, '').trim() || null
  // also strip dangling XML tags
  const finalText = cleanText
    ? cleanText.replace(/<(\/)?(?:invoke|query|parameter)[^>]*>/g, '').trim() || null
    : null
  return { cleanText: finalText, toolCalls }
}
const STOP_REASON_MAP = {
  end_turn: 'stop',
  max_tokens: 'length',
  tool_use: 'tool_calls',
  refusal: 'content_filter',
}

export function anthropicRespToOpenAI(data) {
  const blocks = data.content || []
  const rawText = blocks
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n') || null
  // ponytail: parse Minimax inline tool_call XML → OpenAI tool_calls
  const { cleanText, toolCalls: minimaxToolCalls } = rawText
    ? parseMinimaxToolCalls(rawText)
    : { cleanText: null, toolCalls: [] }
  // ponytail: also extract any standard Anthropic tool_use blocks
  const standardToolCalls = blocks
    .map(blockToToolCall)
    .filter(Boolean)
  const toolCalls = [...standardToolCalls, ...minimaxToolCalls]
  const stopReason = STOP_REASON_MAP[data.stop_reason] || 'stop'
  const finishReason = toolCalls.length > 0 ? 'tool_calls' : stopReason
  return {
    id: data.id || '',
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: data.model || '',
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: cleanText,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      },
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

// ponytail: buffer text, detect complete Minimax tool_call XML blocks, parse to tool_calls
function emitMinimaxClean(textDelta, buf, out, msgId, ts) {
  buf.t = (buf.t || '') + (textDelta || '')
  // ponytail: detect complete </tool_call> → parse into tool_calls + clean text
  const tcEnd = buf.t.indexOf('</tool_call>')
  if (tcEnd !== -1) {
    // extract the full tool_call block
    const afterEnd = tcEnd + '</tool_call>'.length
    const fullChunk = buf.t.slice(0, afterEnd)
    const remainder = buf.t.slice(afterEnd)
    const { cleanText, toolCalls } = parseMinimaxToolCalls(fullChunk)
    // emit parsed tool calls as deltas
    if (toolCalls.length > 0) {
      out.push(`data: ${JSON.stringify({ id: msgId.v, object: 'chat.completion.chunk', created: ts, model: '', choices: [{ index: 0, delta: { tool_calls: toolCalls.map((tc, i) => ({ index: i, id: tc.id, type: tc.type, function: { name: tc.function.name, arguments: tc.function.arguments } })) }, finish_reason: null }] })}\n\n`)
    }
    buf.t = cleanText ? (cleanText + '\n' + remainder) : remainder
    return
  }
  // ponytail: no complete block yet — emit safe prefix, keep 100-char tail
  const cleaned = buf.t
    .replace(/<\]minimax\[>\[/g, '')
    .replace(/<(\/)?(?:tool_call|tool_calls|invoke|query|parameter)[^>]*>/g, '')
  const cutoff = Math.max(0, cleaned.length - 100)
  if (cutoff > 0) {
    out.push(`data: ${JSON.stringify({ id: msgId.v, object: 'chat.completion.chunk', created: ts, model: '', choices: [{ index: 0, delta: { content: cleaned.slice(0, cutoff) }, finish_reason: null }] })}\n\n`)
  }
  buf.t = cleaned.slice(cutoff)
}

// ponytail: Anthropic SSE → OpenAI SSE streaming converter.
// Parses complete SSE events (separated by \n\n) and maps to OpenAI format.
// toolBlockByIndex tracks which content_block indices belong to tool calls.
export function anthropicSSEToOpenAI(rawText, buffer, msgId, toolBlockByIndex) {
  buffer.s += rawText
  const out = []
  while (true) {
    const idx = buffer.s.indexOf('\n\n')
    if (idx === -1) break
    const event = buffer.s.slice(0, idx)
    buffer.s = buffer.s.slice(idx + 2)
    const lines = event.split('\n')
    let evType = '', dataStr = ''
    for (const line of lines) {
      if (line.startsWith('event: ')) evType = line.slice(7)
      else if (line.startsWith('data: ')) dataStr = line.slice(6)
    }
    if (!dataStr) continue
    let data
    try { data = JSON.parse(dataStr) } catch { continue }

    const ts = Math.floor(Date.now() / 1000)
    switch (evType) {
      case 'message_start':
        msgId.v = data.message?.id || msgId.v
        out.push(`data: ${JSON.stringify({ id: msgId.v, object: 'chat.completion.chunk', created: ts, model: data.message?.model || '', choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] })}\n\n`)
        break
      case 'content_block_start': {
        const block = data.content_block
        if (block && (block.type === 'tool_use' || block.type === 'server_tool_use')) {
          const toolType = block.type === 'server_tool_use' ? 'custom' : 'function'
          const tcIndex = data.index
          toolBlockByIndex[tcIndex] = { id: block.id, name: block.name, type: toolType }
          out.push(`data: ${JSON.stringify({ id: msgId.v, object: 'chat.completion.chunk', created: ts, model: '', choices: [{ index: 0, delta: { tool_calls: [{ index: tcIndex, id: block.id, type: toolType, function: { name: block.name, arguments: '' } }] }, finish_reason: null }] })}\n\n`)
        }
        break
      }
      case 'content_block_delta': {
        const delta = data.delta
        const tcIndex = data.index
        if (delta?.type === 'input_json_delta' && toolBlockByIndex[tcIndex]) {
          out.push(`data: ${JSON.stringify({ id: msgId.v, object: 'chat.completion.chunk', created: ts, model: '', choices: [{ index: 0, delta: { tool_calls: [{ index: tcIndex, function: { arguments: delta.partial_json } }] }, finish_reason: null }] })}\n\n`)
        } else if (delta?.type === 'text_delta') {
          emitMinimaxClean(delta.text || '', buffer, out, msgId, ts)
        }
        break
      }
      case 'content_block_stop':
        break
      case 'message_delta': {
        const reason = STOP_REASON_MAP[data.delta?.stop_reason] || 'stop'
        out.push(`data: ${JSON.stringify({ id: msgId.v, object: 'chat.completion.chunk', created: ts, model: '', choices: [{ index: 0, delta: {}, finish_reason: reason }] })}\n\n`)
        break
      }
      case 'message_stop':
        // ponytail: flush remaining minimax text buffer
        if (buffer.t?.trim()) {
          out.push(`data: ${JSON.stringify({ id: msgId.v, object: 'chat.completion.chunk', created: ts, model: '', choices: [{ index: 0, delta: { content: buffer.t }, finish_reason: null }] })}\n\n`)
          buffer.t = ''
        }
        out.push('data: [DONE]\n\n')
        buffer.doneSent = true
        break
    }
  }
  if (out.length === 0) return ''
  if (out.some(s => s.includes('[DONE]'))) buffer.doneSent = true
  return out.join('')
}
