from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import admin, auth_routes, inventory, materials, transactions
from app.bitable.repository import BitableRepository
from app.config import get_settings
from app.utils.response import AppError

logger = logging.getLogger("stock-flow")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    settings = get_settings()
    logger.info("启动 stock-flow API env=%s bitable=%s", settings.app_env, settings.bitable_mode)
    if (
        settings.bitable_mode == "real"
        and settings.bitable_configured
        and settings.bitable_cache_ttl_seconds > 0
        and settings.bitable_warmup_on_startup
    ):
        try:
            results = await BitableRepository(settings).warmup_core_tables()
            failures = {tid: msg for tid, msg in results.items() if msg}
            if failures:
                logger.warning("Bitable 缓存部分预热失败，失败表将按需读取: %s", failures)
            else:
                logger.info("Bitable 五表缓存预热完成")
        except Exception as exc:
            logger.warning("Bitable 缓存预热失败，将在首次请求时按需拉取: %s", exc)
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="物料出入库管理系统 API",
        version="0.1.0",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(AppError)
    async def handle_app_error(_request: Request, exc: AppError):
        return JSONResponse(
            status_code=exc.status_code,
            content={"code": exc.code, "message": exc.message, "data": None},
        )

    @app.exception_handler(HTTPException)
    async def handle_http_error(_request: Request, exc: HTTPException):
        detail = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
        return JSONResponse(
            status_code=exc.status_code,
            content={"code": exc.status_code, "message": detail, "data": None},
        )

    @app.exception_handler(Exception)
    async def handle_unexpected_error(_request: Request, exc: Exception):
        logger.exception("未处理异常: %s", exc)
        message = "服务器内部错误"
        if settings.app_env != "prod":
            message = f"服务器内部错误: {type(exc).__name__}: {exc}"
        return JSONResponse(
            status_code=500,
            content={"code": 500, "message": message, "data": None},
        )

    app.include_router(auth_routes.router)
    app.include_router(materials.router)
    app.include_router(inventory.router)
    app.include_router(transactions.router)
    app.include_router(admin.router)

    return app


app = create_app()
