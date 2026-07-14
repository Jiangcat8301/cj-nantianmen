"""Core LLM proxy logic: resolve model, forward request, stream response, collect stats."""
import json
from typing import Any, Optional

import httpx
from fastapi import HTTPException
from fastapi.responses import StreamingResponse

from app.db.database import get_db
from app.services import provider_service, stats_service, protocol_converter


def _mask_key(key: str) -> str:
    """Mask API key for logging."""
    return key[:4] + "..." + key[-4:] if len(key) > 8 else "***"


def resolve_model(model_field: str) -> tuple[dict, str, str]:
    """
    Parse model field -> (provider_dict, model_name, provider_protocol).

    Model field format: "{provider_protocol}_{model_name}" e.g. "openai_gpt-4o"
    Or "auto" -> use default model from settings.
    """
    if model_field == "auto" or not model_field:
        default = provider_service.get_default_model()
        if not default:
            raise HTTPException(status_code=503, detail="No default model configured")
        # default is "provider_id:model_name"
        provider_id_str, model_name = default.split(":", 1)
        provider_id = int(provider_id_str)
    else:
        # Format: "{protocol}_{model_name}" — but model_name itself can contain underscores
        # We match against the DB: find a provider whose protocol is a prefix
        conn = get_db()
        try:
            providers = conn.execute("SELECT * FROM providers").fetchall()
        finally:
            conn.close()

        matched = None
        for p in providers:
            prefix = p["protocol"] + "_"
            if model_field.startswith(prefix):
                model_name = model_field[len(prefix):]
                matched = (dict(p), model_name)
                break

        if not matched:
            raise HTTPException(status_code=400, detail=f"Cannot resolve model: {model_field}")

        return matched[0], matched[1], matched[0]["protocol"]

    # For auto/default path
    provider = provider_service.get_provider(provider_id)
    if not provider:
        raise HTTPException(status_code=503, detail="Default provider not found")
    return provider, model_name, provider["protocol"]


def _build_headers(provider: dict) -> dict:
    """Build auth headers for provider."""
    if provider["protocol"] == "openai":
        return {"Authorization": f"Bearer {provider['api_key']}", "Content-Type": "application/json"}
    else:  # anthropic
        return {
            "x-api-key": provider["api_key"],
            "Content-Type": "application/json",
            "anthropic-version": "2023-06-01",
        }


def _build_url(provider: dict, inbound_protocol: str) -> str:
    """Build upstream URL based on provider protocol."""
    base = provider["base_url"].rstrip("/")
    if provider["protocol"] == "openai":
        return f"{base}/v1/chat/completions"
    else:  # anthropic
        return f"{base}/v1/messages"


async def proxy_request(
    body: dict,
    inbound_protocol: str,
    api_key_id: Optional[int],
) -> Any:
    """
    Core proxy logic.

    inbound_protocol: "openai" or "anthropic" (what the client sent)
    """
    model_field = body.get("model", "auto")
    provider, model_name, provider_protocol = resolve_model(model_field)

    stats_service.acquire_request()
    try:
        # Check health
        health = await provider_service.check_provider_health(provider["id"])
        if not health.get("healthy"):
            raise HTTPException(status_code=503, detail=f"Provider '{provider['name']}' is unhealthy")

        # Determine conversion path
        is_streaming = body.get("stream", False)

        # Prepare upstream request
        if inbound_protocol == provider_protocol:
            # Passthrough - just swap model name to actual model
            upstream_body = dict(body)
            upstream_body["model"] = model_name
        elif inbound_protocol == "openai" and provider_protocol == "anthropic":
            upstream_body = protocol_converter.openai_req_to_anthropic(body)
            upstream_body["model"] = model_name
        elif inbound_protocol == "anthropic" and provider_protocol == "openai":
            upstream_body = protocol_converter.anthropic_req_to_openai(body)
            upstream_body["model"] = model_name
        else:
            raise HTTPException(status_code=400, detail="Unsupported protocol combination")

        headers = _build_headers(provider)
        url = _build_url(provider, inbound_protocol)

        client = httpx.AsyncClient(timeout=httpx.Timeout(connect=10, read=300, write=30, pool=10))

        if is_streaming:
            return await _stream_response(
                client, url, headers, upstream_body,
                inbound_protocol, provider_protocol,
                provider, model_name, api_key_id,
            )
        else:
            return await _non_stream_response(
                client, url, headers, upstream_body,
                inbound_protocol, provider_protocol,
                provider, model_name, api_key_id,
            )
    except:
        stats_service.release_request()
        raise


async def _non_stream_response(
    client, url, headers, upstream_body,
    inbound_protocol, provider_protocol,
    provider, model_name, api_key_id,
):
    """Non-streaming: forward, convert response, collect stats."""
    try:
        resp = await client.post(url, json=upstream_body, headers=headers)
        resp.raise_for_status()
        data = resp.json()

        # Convert response if needed
        if inbound_protocol == provider_protocol:
            # Passthrough — just swap model name back
            data["model"] = model_name
            input_t, output_t, cached_t = protocol_converter.extract_tokens_openai(data) if provider_protocol == "openai" else protocol_converter.extract_tokens_anthropic(data)
        elif inbound_protocol == "openai" and provider_protocol == "anthropic":
            data = protocol_converter.anthropic_resp_to_openai(data, model_name)
            input_t, output_t, cached_t = protocol_converter.extract_tokens_anthropic(data)
        elif inbound_protocol == "anthropic" and provider_protocol == "openai":
            data = protocol_converter.openai_resp_to_anthropic(data, model_name)
            input_t, output_t, cached_t = protocol_converter.extract_tokens_openai(data)
        else:
            input_t = output_t = cached_t = 0

        # Record stats
        stats_service.record_usage(
            api_key_id=api_key_id,
            provider_id=provider["id"],
            model_name=model_name,
            input_tokens=input_t,
            output_tokens=output_t,
            cached_tokens=cached_t,
        )

        return data
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=f"Upstream error: {e.response.text}")
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"Upstream connection error: {str(e)}")
    finally:
        await client.aclose()
        stats_service.release_request()


async def _stream_response(
    client, url, headers, upstream_body,
    inbound_protocol, provider_protocol,
    provider, model_name, api_key_id,
):
    """Streaming: pipe-through with conversion."""

    async def generate():
        collected_input = 0
        collected_output = 0
        collected_cached = 0
        try:
            async with client.stream("POST", url, json=upstream_body, headers=headers) as resp:
                if resp.status_code != 200:
                    body_text = await resp.aread()
                    yield f"data: {json.dumps({'error': body_text.decode()})}\n\n"
                    return

                async for line in resp.aiter_lines():
                    if not line.strip():
                        continue

                    if inbound_protocol == provider_protocol:
                        # Passthrough
                        yield line + "\n"
                        # Try to extract tokens from SSE
                        if line.startswith("data: ") and line[6:] != "[DONE]":
                            try:
                                chunk = json.loads(line[6:])
                                if provider_protocol == "openai":
                                    u = chunk.get("usage", {})
                                    if u:
                                        collected_input = u.get("prompt_tokens", 0)
                                        collected_output = u.get("completion_tokens", 0)
                                else:
                                    if chunk.get("type") == "message_delta":
                                        u = chunk.get("usage", {})
                                        collected_output = u.get("output_tokens", 0)
                                    elif chunk.get("type") == "message_start":
                                        u = chunk.get("message", {}).get("usage", {})
                                        collected_input = u.get("input_tokens", 0)
                            except json.JSONDecodeError:
                                pass
                    elif inbound_protocol == "openai" and provider_protocol == "anthropic":
                        # Convert Anthropic SSE -> OpenAI SSE
                        converted = protocol_converter.anthropic_sse_to_openai_sse(line, model_name)
                        for c in converted:
                            yield c
                    elif inbound_protocol == "anthropic" and provider_protocol == "openai":
                        # Convert OpenAI SSE -> Anthropic SSE
                        converted = protocol_converter.openai_sse_to_anthropic_sse(line, model_name)
                        for c in converted:
                            yield c
        finally:
            await client.aclose()
            stats_service.release_request()
            stats_service.record_usage(
                api_key_id=api_key_id,
                provider_id=provider["id"],
                model_name=model_name,
                input_tokens=collected_input,
                output_tokens=collected_output,
                cached_tokens=collected_cached,
            )

    return StreamingResponse(generate(), media_type="text/event-stream")
