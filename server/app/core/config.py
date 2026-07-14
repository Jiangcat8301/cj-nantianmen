"""Application configuration."""
import os
from pathlib import Path

from pydantic_settings import BaseSettings

SERVER_DIR = Path(__file__).resolve().parent.parent.parent
DATA_DIR = SERVER_DIR / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)


class Settings(BaseSettings):
    host: str = "127.0.0.1"
    port: int = 7300
    db_path: str = str(DATA_DIR / "nantianmen.db")
    pid_path: str = str(DATA_DIR / "nantianmen.pid")
    secret_key: str = os.environ.get("NANTIANMEN_SECRET_KEY", "change-me-in-production")

    class Config:
        env_prefix = "nantianmen_"


settings = Settings()
