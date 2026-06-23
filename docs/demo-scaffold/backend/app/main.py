"""应用入口 —— FastAPI + lifespan + CORS"""
from contextlib import asynccontextmanager
import logging
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import auth_routes, materials, inventory
from app.config import get_settings

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("scaffold")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    settings = get_settings()
    logger.info("启动 scaffold env=%s bitable=%s", settings.app_env, settings.bitable_mode)
    # TODO real 模式：从 SQLite 回填内存缓存（见 SKILL.md 三级缓存）
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="飞书 Bitable 应用", version="0.1.0", lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(Exception)
    async def handle_unhandled(request: Request, exc: Exception):
        logger.exception("未处理异常")
        return JSONResponse(status_code=500, content={"code": 500, "message": str(exc), "data": None})

    app.include_router(auth_routes.router, prefix="/api")
    app.include_router(materials.router, prefix="/api")
    app.include_router(inventory.router, prefix="/api")

    return app


app = create_app()
