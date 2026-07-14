"""Admin API routes: providers CRUD, health, models, api-keys, stats."""
from fastapi import APIRouter, HTTPException

from app.models import schemas
from app.services import provider_service, apikey_service, stats_service

router = APIRouter(prefix="/api/admin", tags=["admin"])


# ---------------------------------------------------------------------------
# Providers
# ---------------------------------------------------------------------------
@router.get("/providers", response_model=list[schemas.ProviderOut])
def list_providers():
    providers = provider_service.list_providers()
    # Mask api_key in output
    for p in providers:
        k = p["api_key"]
        p["api_key"] = k[:4] + "..." + k[-4:] if len(k) > 8 else "***"
    return providers


@router.post("/providers", response_model=schemas.ProviderOut)
def create_provider(req: schemas.ProviderCreate):
    if req.protocol not in ("openai", "anthropic"):
        raise HTTPException(400, "protocol must be 'openai' or 'anthropic'")
    p = provider_service.create_provider(req.name, req.protocol, req.base_url, req.api_key)
    k = p["api_key"]
    p["api_key"] = k[:4] + "..." + k[-4:] if len(k) > 8 else "***"
    return p


@router.put("/providers/{provider_id}", response_model=schemas.ProviderOut)
def update_provider(provider_id: int, req: schemas.ProviderUpdate):
    p = provider_service.update_provider(
        provider_id,
        name=req.name, protocol=req.protocol, base_url=req.base_url, api_key=req.api_key,
    )
    if not p:
        raise HTTPException(404, "Provider not found")
    k = p["api_key"]
    p["api_key"] = k[:4] + "..." + k[-4:] if len(k) > 8 else "***"
    return p


@router.delete("/providers/{provider_id}")
def delete_provider(provider_id: int):
    if not provider_service.delete_provider(provider_id):
        raise HTTPException(404, "Provider not found")
    return {"ok": True}


@router.post("/providers/{provider_id}/health")
async def check_health(provider_id: int):
    result = await provider_service.check_provider_health(provider_id)
    if "error" in result and "Provider not found" in result.get("error", ""):
        raise HTTPException(404, "Provider not found")
    return result


@router.get("/providers/{provider_id}/models", response_model=list[schemas.ModelOut])
async def fetch_models(provider_id: int):
    if not provider_service.get_provider(provider_id):
        raise HTTPException(404, "Provider not found")
    # Fetch from upstream + DB
    await provider_service.fetch_provider_models(provider_id)
    return provider_service.list_provider_models(provider_id)


@router.put("/providers/{provider_id}/models/{model_id}/default")
def set_default_model(provider_id: int, model_id: int):
    result = provider_service.set_default_model(provider_id, model_id)
    if not result:
        raise HTTPException(404, "Model not found for this provider")
    return result


# ---------------------------------------------------------------------------
# API Keys
# ---------------------------------------------------------------------------
@router.get("/api-keys", response_model=list[schemas.ApiKeyOut])
def list_api_keys():
    return apikey_service.list_api_keys()


@router.post("/api-keys", response_model=schemas.ApiKeyOut)
def create_api_key(req: schemas.ApiKeyCreate):
    return apikey_service.create_api_key(req.name, req.note)


@router.put("/api-keys/{key_id}", response_model=schemas.ApiKeyOut)
def update_api_key(key_id: int, req: schemas.ApiKeyUpdate):
    result = apikey_service.update_api_key(key_id, req.name, req.note)
    if not result:
        raise HTTPException(404, "API key not found")
    return result


@router.delete("/api-keys/{key_id}")
def delete_api_key(key_id: int):
    if not apikey_service.delete_api_key(key_id):
        raise HTTPException(404, "API key not found")
    return {"ok": True}


# ---------------------------------------------------------------------------
# Stats
# ---------------------------------------------------------------------------
@router.get("/stats")
def get_stats(
    provider_id: int | None = None,
    model_name: str | None = None,
    api_key_id: int | None = None,
    start_time: str | None = None,
    end_time: str | None = None,
):
    return stats_service.query_stats(
        provider_id=provider_id,
        model_name=model_name,
        api_key_id=api_key_id,
        start_time=start_time,
        end_time=end_time,
    )
