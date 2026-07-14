"""API key management service."""
from typing import Optional

from app.core.security import generate_api_key
from app.db.database import get_db


def list_api_keys() -> list[dict]:
    conn = get_db()
    try:
        rows = conn.execute("SELECT * FROM api_keys ORDER BY id").fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def create_api_key(name: str = "", note: str = "") -> dict:
    key = generate_api_key()
    conn = get_db()
    try:
        conn.execute(
            "INSERT INTO api_keys(key, name, note) VALUES (?,?,?)",
            (key, name, note),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM api_keys WHERE key=?", (key,)).fetchone()
        return dict(row)
    finally:
        conn.close()


def delete_api_key(api_key_id: int) -> bool:
    conn = get_db()
    try:
        cur = conn.execute("DELETE FROM api_keys WHERE id=?", (api_key_id,))
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def update_api_key(api_key_id: int, name: Optional[str] = None, note: Optional[str] = None) -> Optional[dict]:
    conn = get_db()
    try:
        existing = conn.execute("SELECT * FROM api_keys WHERE id=?", (api_key_id,)).fetchone()
        if not existing:
            return None
        n = name if name is not None else existing["name"]
        nt = note if note is not None else existing["note"]
        conn.execute("UPDATE api_keys SET name=?, note=? WHERE id=?", (n, nt, api_key_id))
        conn.commit()
        row = conn.execute("SELECT * FROM api_keys WHERE id=?", (api_key_id,)).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()
