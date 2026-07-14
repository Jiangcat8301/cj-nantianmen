"""FastAPI app setup: routers, lifecycle events, uvicorn run."""
import os
import sys

from fastapi import FastAPI

from app.core.config import settings
from app.core.security import acquire_pid_lock, release_pid_lock
from app.db.init_db import init_db
from app.services import provider_service
from app.services.stats_service import start_flush_task, stop_flush_task, flush_to_db
from app.api import admin_routes, llm_routes

app = FastAPI(
    title="Nantianmen LLM Gateway",
    version="0.1.0",
    description="Multi-protocol LLM proxy gateway",
)
app.include_router(admin_routes.router)
app.include_router(llm_routes.router)


@app.on_event("startup")
async def on_startup():
    """Init DB + acquire PID lock + start stats flush + build model map."""
    init_db()
    if not acquire_pid_lock():
        print(f"[ERROR] Another instance is running (PID file: {settings.pid_path})")
        sys.exit(1)
    start_flush_task()
    provider_service.rebuild_model_map()
    print(f"[Nantianmen] started on {settings.host}:{settings.port}, PID={os.getpid()}")


@app.on_event("shutdown")
async def on_shutdown():
    """Cleanup PID + flush stats."""
    flush_to_db()
    stop_flush_task()
    release_pid_lock()
    print("[Nantianmen] stopped")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        reload=False,
    )
