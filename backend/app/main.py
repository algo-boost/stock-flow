from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import os

from app.api import admin, auth_routes, feishu_events, inventory, materials, returns, transactions
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
        and settings.bitable_warmup_on_startup
    ):
        try:
            repo = BitableRepository(settings)
            # 优先从 SQLite 本地缓存预热（毫秒级）
            if settings.sqlite_cache_enabled:
                from app.bitable.sqlite_cache import get_sqlite_cache
                sqlite = get_sqlite_cache()
                snap = sqlite.snapshot()
                if snap:
                    logger.info("SQLite 缓存命中 %d 表 (%d 条记录)，启动即用", len(snap), sum(snap.values()))
                else:
                    # SQLite 为空 → 自动从 Bitable 全量恢复
                    logger.info("SQLite 缓存为空，正在从 Bitable 自动恢复…")
                    core_ids = [
                        settings.bitable_table_categories,
                        settings.bitable_table_locations,
                        settings.bitable_table_materials,
                        settings.bitable_table_inventory,
                        settings.bitable_table_transactions,
                        settings.bitable_table_requests,
                    ]
                    recovered = 0
                    for table_id in core_ids:
                        if not table_id:
                            continue
                        try:
                            records = await repo.client.list_records(table_id)
                            if records:
                                sqlite.upsert_records(table_id, records)
                                recovered += len(records)
                        except Exception as exc:
                            logger.warning("恢复 %s 失败: %s", table_id, exc)
                    logger.info("Bitable 自动恢复完成: %d 条记录写入 SQLite", recovered)
            else:
                results = await repo.warmup_core_tables()
                failures = {tid: msg for tid, msg in results.items() if msg}
                if failures:
                    logger.warning("Bitable 缓存部分预热失败: %s", failures)
                else:
                    logger.info("Bitable 五表缓存预热完成")
        except Exception as exc:
            logger.warning("缓存预热失败，将在首次请求时按需拉取: %s", exc)
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

    # 浏览器缓存：手机端不再重复下载
    @app.middleware("http")
    async def cache_headers(request: Request, call_next):
        response = await call_next(request)
        if request.method == "GET" and response.status_code < 400:
            if request.url.path.startswith("/api/"):
                response.headers["Cache-Control"] = "private, max-age=1800"
            elif "/assets/" in request.url.path or request.url.path.endswith((".js", ".css", ".png")):
                response.headers["Cache-Control"] = "public, max-age=86400"
        return response

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

    app.include_router(auth_routes.router, prefix="/api")
    app.include_router(materials.router, prefix="/api")
    app.include_router(inventory.router, prefix="/api")
    app.include_router(transactions.router, prefix="/api")
    app.include_router(returns.router, prefix="/api")
    app.include_router(admin.router, prefix="/api")
    app.include_router(feishu_events.router)  # 自带 /api/ 前缀，不加 prefix

    # 生产模式：托管前端构建产物（dist/）
    dist_dir = os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "dist")
    if os.path.isdir(dist_dir):
        from fastapi.responses import FileResponse

        @app.middleware("http")
        async def frontend_spa_middleware(request: Request, call_next):
            """API 路由走正常处理；404 的不走 API 前缀的则返回前端 SPA。"""
            response = await call_next(request)
            if response.status_code == 404 and not request.url.path.startswith("/api/"):
                path = os.path.join(dist_dir, request.url.path.lstrip("/"))
                if os.path.isfile(path):
                    return FileResponse(path)
                return FileResponse(os.path.join(dist_dir, "index.html"))
            return response

    return app


app = create_app()
