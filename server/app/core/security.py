"""PID file lock + API key auth."""
import os
import secrets
from pathlib import Path

from fastapi import Depends, Header, HTTPException, status

from app.core.config import settings
from app.db.database import get_db


# ---------------------------------------------------------------------------
# PID file lock
# ---------------------------------------------------------------------------
def acquire_pid_lock() -> bool:
    """Try to acquire PID lock. Returns True if acquired, False if already running."""
    pid_file = Path(settings.pid_path)
    if pid_file.exists():
        old_pid = pid_file.read_text().strip()
        if old_pid:
            try:
                # Check if that process is still alive
                os.kill(int(old_pid), 0)
                return False  # process still running
            except (ProcessLookupError, ValueError, OSError):
                pass  # stale PID file, reclaim
    pid_file.write_text(str(os.getpid()))
    return True


def release_pid_lock():
    """Remove PID file on shutdown."""
    pid_file = Path(settings.pid_path)
    if pid_file.exists():
        pid_file.unlink(missing_ok=True)


# ---------------------------------------------------------------------------
# API key generation & auth
# ---------------------------------------------------------------------------
def generate_api_key() -> str:
    return "skm-" + secrets.token_urlsafe(32)


def get_api_key_from_request(
    authorization: str | None = Header(None),
    x_api_key: str | None = Header(None, alias="x-api-key"),
) -> str | None:
    """Extract API key from Bearer token or x-api-key header."""
    if authorization and authorization.startswith("Bearer "):
        return authorization[7:]
    if x_api_key:
        return x_api_key
    return None


def verify_api_key(
    authorization: str | None = Header(None),
    x_api_key: str | None = Header(None, alias="x-api-key"),
) -> dict:
    """FastAPI dependency: verify API key, return key row dict."""
    key = get_api_key_from_request(authorization, x_api_key)
    if not key:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing API key")

    conn = get_db()
    try:
        row = conn.execute("SELECT * FROM api_keys WHERE key=?", (key,)).fetchone()
        if not row:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API key")
        # Update last_used_at
        conn.execute(
            "UPDATE api_keys SET last_used_at=datetime('now') WHERE id=?", (row["id"],)
        )
        conn.commit()
        return dict(row)
    finally:
        conn.close()
