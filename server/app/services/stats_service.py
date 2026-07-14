"""Stats service: in-memory counter + background flush + query."""
import asyncio
import time
from collections import defaultdict
from typing import Optional

from app.db.database import get_db

# In-memory counter: {(api_key_id, provider_id, model_name): {request_count, input_tokens, output_tokens, cached_tokens}}
_buffer: dict[tuple, dict] = defaultdict(lambda: {
    "request_count": 0,
    "input_tokens": 0,
    "output_tokens": 0,
    "cached_tokens": 0,
})
_flush_task: Optional[asyncio.Task] = None


def record_usage(
    api_key_id: Optional[int],
    provider_id: Optional[int],
    model_name: str,
    input_tokens: int = 0,
    output_tokens: int = 0,
    cached_tokens: int = 0,
):
    """Record usage in memory buffer. Non-blocking."""
    key = (api_key_id, provider_id, model_name)
    _buffer[key]["request_count"] += 1
    _buffer[key]["input_tokens"] += input_tokens
    _buffer[key]["output_tokens"] += output_tokens
    _buffer[key]["cached_tokens"] += cached_tokens


def flush_to_db():
    """Flush in-memory buffer to SQLite."""
    if not _buffer:
        return
    conn = get_db()
    try:
        for (api_key_id, provider_id, model_name), stats in _buffer.items():
            conn.execute(
                """INSERT INTO usage_stats(api_key_id, provider_id, model_name, request_count, input_tokens, output_tokens, cached_tokens)
                   VALUES (?,?,?,?,?,?,?)""",
                (
                    api_key_id,
                    provider_id,
                    model_name,
                    stats["request_count"],
                    stats["input_tokens"],
                    stats["output_tokens"],
                    stats["cached_tokens"],
                ),
            )
        conn.commit()
        _buffer.clear()
    finally:
        conn.close()


async def stats_flush_loop():
    """Background task: flush every 10 seconds."""
    while True:
        await asyncio.sleep(10)
        try:
            flush_to_db()
        except Exception as e:
            print(f"[stats] flush error: {e}")


def start_flush_task():
    global _flush_task
    if _flush_task is None or _flush_task.done():
        _flush_task = asyncio.create_task(stats_flush_loop())


def stop_flush_task():
    global _flush_task
    if _flush_task and not _flush_task.done():
        _flush_task.cancel()
        _flush_task = None


def query_stats(
    provider_id: Optional[int] = None,
    model_name: Optional[str] = None,
    api_key_id: Optional[int] = None,
    start_time: Optional[str] = None,
    end_time: Optional[str] = None,
) -> list[dict]:
    """Query usage stats from SQLite."""
    conn = get_db()
    try:
        sql = "SELECT provider_id, model_name, api_key_id, SUM(request_count) as request_count, SUM(input_tokens) as input_tokens, SUM(output_tokens) as output_tokens, SUM(cached_tokens) as cached_tokens FROM usage_stats WHERE 1=1"
        params = []
        if provider_id is not None:
            sql += " AND provider_id=?"
            params.append(provider_id)
        if model_name is not None:
            sql += " AND model_name=?"
            params.append(model_name)
        if api_key_id is not None:
            sql += " AND api_key_id=?"
            params.append(api_key_id)
        if start_time:
            sql += " AND created_at >= ?"
            params.append(start_time)
        if end_time:
            sql += " AND created_at <= ?"
            params.append(end_time)
        sql += " GROUP BY provider_id, model_name, api_key_id"
        rows = conn.execute(sql, params).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()
