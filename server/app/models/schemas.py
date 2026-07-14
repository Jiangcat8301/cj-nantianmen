"""Pydantic models for all API requests/responses."""
from typing import Any, Optional
from pydantic import BaseModel


# ---------------------------------------------------------------------------
# Provider
# ---------------------------------------------------------------------------
class ProviderCreate(BaseModel):
    name: str
    protocol: str  # "openai" | "anthropic"
    base_url: str
    api_key: str = ""


class ProviderUpdate(BaseModel):
    name: Optional[str] = None
    protocol: Optional[str] = None
    base_url: Optional[str] = None
    api_key: Optional[str] = None


class ProviderOut(BaseModel):
    id: int
    name: str
    protocol: str
    base_url: str
    api_key: str  # masked in route
    created_at: str
    updated_at: str


class ModelOut(BaseModel):
    id: int
    provider_id: int
    model_name: str
    is_default: bool
    is_manual: bool
    created_at: str


# ---------------------------------------------------------------------------
# API Key
# ---------------------------------------------------------------------------
class ApiKeyCreate(BaseModel):
    name: str = ""
    note: str = ""


class ApiKeyUpdate(BaseModel):
    name: Optional[str] = None
    note: Optional[str] = None


class ApiKeyOut(BaseModel):
    id: int
    key: str
    name: str
    note: str
    created_at: str
    last_used_at: Optional[str] = None


# ---------------------------------------------------------------------------
# Stats
# ---------------------------------------------------------------------------
class StatsQuery(BaseModel):
    provider_id: Optional[int] = None
    model_name: Optional[str] = None
    api_key_id: Optional[int] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None


class StatsOut(BaseModel):
    provider_id: Optional[int]
    model_name: Optional[str]
    api_key_id: Optional[int]
    request_count: int
    input_tokens: int
    output_tokens: int
    cached_tokens: int
