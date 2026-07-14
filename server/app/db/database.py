"""SQLite connection helper with WAL mode and foreign keys."""
import sqlite3
from pathlib import Path

from app.core.config import settings


def get_db() -> sqlite3.Connection:
    """Get a SQLite connection. Caller is responsible for closing."""
    Path(settings.db_path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(settings.db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn
