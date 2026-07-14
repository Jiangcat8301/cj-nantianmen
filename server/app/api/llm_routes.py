"""LLM proxy routes: chat/completions, messages, models, health."""
import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Header
from fastapi.responses import JSONResponse, StreamingResponse

from app.core.security import verify_api_key
from app.db.database import get_db
from app.services import provider_service, llm_proxy, stats_service

router = APIRouter(tags=["llm"])


@router.get("/v1/health")
async def health():
    return {
        "status": "ok",
        "service": "nantianmen",
        "active_requests": stats_service.get_active_count(),
    }


@router.get("/v1/models")
async def list_models():
    """Return available models in format: {protocol}_{model_name}."""
    conn = get_db()
    try:
        rows = conn.execute(
            """SELECT m.*, p.protocol, p.name as provider_name
               FROM models m JOIN providers p ON m.provider_id = p.id
               ORDER BY p.id, m.model_name"""
        ).fetchall()
        models = []
        for r in rows:
            models.append({
                "id": f"{r['protocol']}_{r['model_name']}",
                "object": "model",
                "created": 0,
                "owned_by": r["provider_name"],
            })
        return {"object": "list", "data": models}
    finally:
        conn.close()


@router.post("/v1/chat/completions")
async def chat_completions(
    body: dict,
    auth: dict = Depends(verify_api_key),
):
    """OpenAI Chat Completions endpoint."""
    result = await llm_proxy.proxy_request(body, "openai", auth["id"])
    if isinstance(result, dict):
        return JSONResponse(content=result)
    return result  # StreamingResponse


@router.post("/v1/messages")
async def messages(
    body: dict,
    auth: dict = Depends(verify_api_key),
):
    """Anthropic Messages endpoint."""
    result = await llm_proxy.proxy_request(body, "anthropic", auth["id"])
    if isinstance(result, dict):
        return JSONResponse(content=result)
    return result  # StreamingResponse
