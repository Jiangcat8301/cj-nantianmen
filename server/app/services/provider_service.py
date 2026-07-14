"""Provider management service: CRUD + health check + model fetch + cache."""
import time
import httpx
from typing import Optional

from app.db.database import get_db

# In-memory model cache: {provider_id: {"models": [...], "ts": float, "ttl": 300}}
_model_cache: dict[int, dict] = {}
CACHE_TTL = 300  # 5 minutes


def _row_to_dict(row) -> dict:
    return dict(row) if row else None


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------
def list_providers() -> list[dict]:
    conn = get_db()
    try:
        rows = conn.execute("SELECT * FROM providers ORDER BY id").fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_provider(provider_id: int) -> Optional[dict]:
    conn = get_db()
    try:
        row = conn.execute("SELECT * FROM providers WHERE id=?", (provider_id,)).fetchone()
        return _row_to_dict(row)
    finally:
        conn.close()


def create_provider(name: str, protocol: str, base_url: str, api_key: str) -> dict:
    conn = get_db()
    try:
        conn.execute(
            "INSERT INTO providers(name, protocol, base_url, api_key) VALUES (?,?,?,?)",
            (name, protocol, base_url, api_key),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM providers WHERE name=?", (name,)).fetchone()
        return dict(row)
    finally:
        conn.close()


def update_provider(provider_id: int, **fields) -> Optional[dict]:
    conn = get_db()
    try:
        existing = conn.execute("SELECT * FROM providers WHERE id=?", (provider_id,)).fetchone()
        if not existing:
            return None
        data = dict(existing)
        for k, v in fields.items():
            if v is not None:
                data[k] = v
        conn.execute(
            "UPDATE providers SET name=?, protocol=?, base_url=?, api_key=?, updated_at=datetime('now') WHERE id=?",
            (data["name"], data["protocol"], data["base_url"], data["api_key"], provider_id),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM providers WHERE id=?", (provider_id,)).fetchone()
        return _row_to_dict(row)
    finally:
        conn.close()


def delete_provider(provider_id: int) -> bool:
    conn = get_db()
    try:
        cur = conn.execute("DELETE FROM providers WHERE id=?", (provider_id,))
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------
async def check_provider_health(provider_id: int) -> dict:
    provider = get_provider(provider_id)
    if not provider:
        return {"healthy": False, "error": "Provider not found"}

    url = provider["base_url"].rstrip("/") + "/models"
    headers = {}
    if provider["protocol"] == "openai":
        headers["Authorization"] = f"Bearer {provider['api_key']}"
    else:  # anthropic
        headers["x-api-key"] = provider["api_key"]
        headers["anthropic-version"] = "2023-06-01"

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(url, headers=headers)
            healthy = resp.status_code == 200
            return {"healthy": healthy, "status_code": resp.status_code}
    except Exception as e:
        return {"healthy": False, "error": str(e)}


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
async def fetch_provider_models(provider_id: int) -> list[str]:
    """Fetch models from provider API, update DB, return model names."""
    provider = get_provider(provider_id)
    if not provider:
        return []

    # Check cache
    cached = _model_cache.get(provider_id)
    if cached and (time.time() - cached["ts"]) < cached["ttl"]:
        return cached["models"]

    url = provider["base_url"].rstrip("/") + "/models"
    headers = {}
    if provider["protocol"] == "openai":
        headers["Authorization"] = f"Bearer {provider['api_key']}"
    else:
        headers["x-api-key"] = provider["api_key"]
        headers["anthropic-version"] = "2023-06-01"

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(url, headers=headers)
            resp.raise_for_status()
            data = resp.json()
            # OpenAI: {"data": [{"id": "gpt-4o"}, ...]}
            # Anthropic: {"data": [{"id": "claude-3-5-sonnet-20241022"}, ...]}
            model_names = [m["id"] for m in data.get("data", [])]
    except Exception:
        model_names = []

    # Cache in memory
    _model_cache[provider_id] = {"models": model_names, "ts": time.time(), "ttl": CACHE_TTL}

    # Persist to DB
    conn = get_db()
    try:
        for name in model_names:
            conn.execute(
                "INSERT OR IGNORE INTO models(provider_id, model_name) VALUES (?,?)",
                (provider_id, name),
            )
        conn.commit()
    finally:
        conn.close()

    return model_names


def list_provider_models(provider_id: int, include_db: bool = True) -> list[dict]:
    conn = get_db()
    try:
        rows = conn.execute(
            "SELECT * FROM models WHERE provider_id=? ORDER BY id", (provider_id,)
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def set_default_model(provider_id: int, model_id: int) -> Optional[dict]:
    conn = get_db()
    try:
        # Verify model belongs to provider
        model = conn.execute(
            "SELECT * FROM models WHERE id=? AND provider_id=?", (model_id, provider_id)
        ).fetchone()
        if not model:
            return None

        # Clear all defaults
        conn.execute("UPDATE models SET is_default=0")
        # Set new default
        conn.execute("UPDATE models SET is_default=1 WHERE id=?", (model_id,))
        # Update settings
        conn.execute(
            "UPDATE settings SET value=? WHERE key='default_model'",
            (f"{provider_id}:{model['model_name']}",),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM models WHERE id=?", (model_id,)).fetchone()
        return _row_to_dict(row)
    finally:
        conn.close()


def get_default_model() -> Optional[str]:
    """Returns 'provider_id:model_name' or None."""
    conn = get_db()
    try:
        row = conn.execute("SELECT value FROM settings WHERE key='default_model'").fetchone()
        return row["value"] if row else None
    finally:
        conn.close()
