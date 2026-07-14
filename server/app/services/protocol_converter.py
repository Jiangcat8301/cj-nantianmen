"""Protocol converter for 4 conversion paths.

Paths:
1. OpenAI Chat -> OpenAI Chat (passthrough)
2. OpenAI Chat -> Anthropic Messages (convert req+resp)
3. Anthropic Messages -> OpenAI Chat (convert req+resp)
4. Anthropic Messages -> Anthropic Messages (passthrough)

Identified by (inbound_protocol, provider_protocol).
"""
import json
import time
from typing import Any


# ---------------------------------------------------------------------------
# OpenAI -> Anthropic conversion
# ---------------------------------------------------------------------------
def openai_req_to_anthropic(body: dict) -> dict:
    """Convert OpenAI Chat Completions request -> Anthropic Messages request."""
    messages = body.get("messages", [])
    system = ""
    anthropic_msgs = []

    for msg in messages:
        role = msg.get("role")
        content = msg.get("content", "")
        if role == "system":
            # Accumulate system messages
            system += content + "\n" if system else content
        elif role == "tool":
            # OpenAI tool result -> Anthropic tool_result
            anthropic_msgs.append({
                "role": "user",
                "content": [{
                    "type": "tool_result",
                    "tool_use_id": msg.get("tool_call_id", ""),
                    "content": content,
                }],
            })
        else:
            # user / assistant
            anthropic_msgs.append({"role": role, "content": content})

    result: dict[str, Any] = {
        "model": body.get("model", ""),
        "messages": anthropic_msgs,
        "max_tokens": body.get("max_tokens", 4096),
    }
    if system:
        result["system"] = system
    if body.get("temperature") is not None:
        result["temperature"] = body["temperature"]
    if body.get("stream"):
        result["stream"] = True

    # Convert tools
    if body.get("tools"):
        result["tools"] = [
            {
                "name": t["function"]["name"],
                "description": t["function"].get("description", ""),
                "input_schema": t["function"].get("parameters", {"type": "object"}),
            }
            for t in body["tools"]
        ]

    return result


def anthropic_resp_to_openai(body: dict, model: str) -> dict:
    """Convert Anthropic Messages response -> OpenAI Chat Completions response."""
    content_blocks = body.get("content", [])
    text = ""
    tool_calls = []
    for block in content_blocks:
        if block.get("type") == "text":
            text += block.get("text", "")
        elif block.get("type") == "tool_use":
            tool_calls.append({
                "id": block.get("id", ""),
                "type": "function",
                "function": {
                    "name": block.get("name", ""),
                    "arguments": json.dumps(block.get("input", {})),
                },
            })

    message: dict[str, Any] = {"role": "assistant", "content": text}
    if tool_calls:
        message["tool_calls"] = tool_calls

    usage = body.get("usage", {})
    return {
        "id": body.get("id", f"chatcmpl-{int(time.time())}"),
        "object": "chat.completion",
        "created": int(time.time()),
        "model": model,
        "choices": [{"index": 0, "message": message, "finish_reason": body.get("stop_reason", "stop")}],
        "usage": {
            "prompt_tokens": usage.get("input_tokens", 0),
            "completion_tokens": usage.get("output_tokens", 0),
            "total_tokens": usage.get("input_tokens", 0) + usage.get("output_tokens", 0),
        },
    }


# ---------------------------------------------------------------------------
# Anthropic -> OpenAI conversion
# ---------------------------------------------------------------------------
def anthropic_req_to_openai(body: dict) -> dict:
    """Convert Anthropic Messages request -> OpenAI Chat Completions request."""
    messages = body.get("messages", [])
    system = body.get("system")
    openai_msgs = []

    if system:
        openai_msgs.append({"role": "system", "content": system})

    for msg in messages:
        role = msg.get("role")
        content = msg.get("content")
        # Anthropic content can be string or list of blocks
        if isinstance(content, list):
            text_parts = []
            tool_calls = []
            tool_results = []
            for block in content:
                if isinstance(block, str):
                    text_parts.append(block)
                elif block.get("type") == "text":
                    text_parts.append(block.get("text", ""))
                elif block.get("type") == "tool_use":
                    tool_calls.append({
                        "id": block.get("id", ""),
                        "type": "function",
                        "function": {
                            "name": block.get("name", ""),
                            "arguments": json.dumps(block.get("input", {})),
                        },
                    })
                elif block.get("type") == "tool_result":
                    tool_results.append(block.get("content", ""))
            if tool_calls:
                openai_msgs.append({
                    "role": role,
                    "content": "\n".join(text_parts) or None,
                    "tool_calls": tool_calls,
                })
            elif tool_results:
                # Convert tool_result blocks to tool role messages
                openai_msgs.append({
                    "role": "tool",
                    "content": "\n".join(tool_results),
                    "tool_call_id": "",
                })
            else:
                openai_msgs.append({"role": role, "content": "\n".join(text_parts)})
        else:
            openai_msgs.append({"role": role, "content": content})

    result: dict[str, Any] = {
        "model": body.get("model", ""),
        "messages": openai_msgs,
        "max_tokens": body.get("max_tokens", 4096),
    }
    if body.get("temperature") is not None:
        result["temperature"] = body["temperature"]
    if body.get("stream"):
        result["stream"] = True

    # Convert tools
    if body.get("tools"):
        result["tools"] = [
            {
                "type": "function",
                "function": {
                    "name": t.get("name", ""),
                    "description": t.get("description", ""),
                    "parameters": t.get("input_schema", {"type": "object"}),
                },
            }
            for t in body["tools"]
        ]

    return result


def openai_resp_to_anthropic(body: dict, model: str) -> dict:
    """Convert OpenAI Chat Completions response -> Anthropic Messages response."""
    choice = body.get("choices", [{}])[0]
    message = choice.get("message", {})
    content = message.get("content", "")
    tool_calls = message.get("tool_calls", [])

    blocks = []
    if content:
        blocks.append({"type": "text", "text": content})
    for tc in tool_calls:
        blocks.append({
            "type": "tool_use",
            "id": tc.get("id", ""),
            "name": tc["function"]["name"],
            "input": json.loads(tc["function"]["arguments"]),
        })

    usage = body.get("usage", {})
    return {
        "id": body.get("id", ""),
        "type": "message",
        "role": "assistant",
        "model": model,
        "content": blocks,
        "stop_reason": choice.get("finish_reason", "stop"),
        "usage": {
            "input_tokens": usage.get("prompt_tokens", 0),
            "output_tokens": usage.get("completion_tokens", 0),
        },
    }


# ---------------------------------------------------------------------------
# Streaming conversion helpers
# ---------------------------------------------------------------------------
def openai_sse_to_anthropic_sse(line: str, model: str) -> list[str]:
    """Convert one OpenAI SSE line to Anthropic SSE lines."""
    if not line.startswith("data: "):
        return [line]
    data = line[6:]
    if data.strip() == "[DONE]":
        return ["event: message_stop\ndata: {\"type\": \"message_stop\"}\n"]

    try:
        chunk = json.loads(data)
    except json.JSONDecodeError:
        return [line]

    choices = chunk.get("choices", [])
    if not choices:
        return [line]
    delta = choices[0].get("delta", {})

    out_lines = []
    if delta.get("role") == "assistant":
        # message_start
        out_lines.append(
            "event: message_start\ndata: " + json.dumps({
                "type": "message_start",
                "message": {"id": chunk.get("id", ""), "type": "message", "role": "assistant", "model": model, "content": [], "stop_reason": None, "usage": {"input_tokens": 0, "output_tokens": 0}},
            }) + "\n"
        )
    if delta.get("content"):
        out_lines.append(
            "event: content_block_delta\ndata: " + json.dumps({
                "type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": delta["content"]},
            }) + "\n"
        )
    if delta.get("tool_calls"):
        for tc in delta["tool_calls"]:
            out_lines.append(
                "event: content_block_delta\ndata: " + json.dumps({
                    "type": "content_block_delta", "index": 0, "delta": {"type": "input_json_delta", "partial_json": tc.get("function", {}).get("arguments", "")},
                }) + "\n"
            )
    if choices[0].get("finish_reason"):
        out_lines.append("event: message_delta\ndata: " + json.dumps({"type": "message_delta", "delta": {"stop_reason": choices[0]["finish_reason"]}, "usage": {"output_tokens": 0}}) + "\n")

    return out_lines


def anthropic_sse_to_openai_sse(line: str, model: str) -> list[str]:
    """Convert one Anthropic SSE line to OpenAI SSE lines."""
    if not line.startswith("data: "):
        return [line]
    data = line[6:]
    try:
        chunk = json.loads(data)
    except json.JSONDecodeError:
        return [line]

    event_type = chunk.get("type", "")
    out_lines = []

    if event_type == "message_start":
        out_lines.append("data: " + json.dumps({"id": chunk["message"]["id"], "object": "chat.completion.chunk", "created": int(time.time()), "model": model, "choices": [{"index": 0, "delta": {"role": "assistant"}, "finish_reason": None}]}) + "\n")
    elif event_type == "content_block_delta":
        delta = chunk.get("delta", {})
        if delta.get("type") == "text_delta":
            out_lines.append("data: " + json.dumps({"id": "", "object": "chat.completion.chunk", "created": int(time.time()), "model": model, "choices": [{"index": 0, "delta": {"content": delta.get("text", "")}, "finish_reason": None}]}) + "\n")
        elif delta.get("type") == "input_json_delta":
            out_lines.append("data: " + json.dumps({"id": "", "object": "chat.completion.chunk", "created": int(time.time()), "model": model, "choices": [{"index": 0, "delta": {"tool_calls": [{"index": 0, "function": {"arguments": delta.get("partial_json", "")}}]}, "finish_reason": None}]}) + "\n")
    elif event_type == "message_delta":
        stop_reason = chunk.get("delta", {}).get("stop_reason")
        out_lines.append("data: " + json.dumps({"id": "", "object": "chat.completion.chunk", "created": int(time.time()), "model": model, "choices": [{"index": 0, "delta": {}, "finish_reason": stop_reason or "stop"}]}) + "\n")
    elif event_type == "message_stop":
        out_lines.append("data: [DONE]\n")

    return out_lines


# ---------------------------------------------------------------------------
# Token extraction from responses
# ---------------------------------------------------------------------------
def extract_tokens_openai(body: dict) -> tuple[int, int, int]:
    """Returns (input_tokens, output_tokens, cached_tokens)."""
    usage = body.get("usage", {})
    return (
        usage.get("prompt_tokens", 0),
        usage.get("completion_tokens", 0),
        usage.get("prompt_tokens_details", {}).get("cached_tokens", 0) if isinstance(usage.get("prompt_tokens_details"), dict) else 0,
    )


def extract_tokens_anthropic(body: dict) -> tuple[int, int, int]:
    """Returns (input_tokens, output_tokens, cached_tokens)."""
    usage = body.get("usage", {})
    cached = usage.get("cache_read_input_tokens", 0)
    return (
        usage.get("input_tokens", 0),
        usage.get("output_tokens", 0),
        cached,
    )
