from __future__ import annotations

import asyncio
import time

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field

from app.auth.deps import exchange_code_for_user, get_current_user
from app.config import Settings, get_settings
from app.models import MeResponse, User
from app.services.feishu_client import FeishuClient
from app.services.session_store import create_session, get_session_entry
from app.utils.response import success

router = APIRouter(tags=["auth"])


class FeishuLoginRequest(BaseModel):
    code: str = Field(min_length=1)


def _map_feishu_error(exc: Exception) -> HTTPException:
    msg = str(exc) or "飞书接口调用失败"
    return HTTPException(status_code=502, detail=msg)


@router.get("/users/search")
async def search_users(
    q: str = Query(default="", max_length=100),
    limit: int = Query(default=20, ge=1, le=50),
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    del user
    if settings.mock_auth_enabled:
        from app.utils.mock_directory import search_mock_directory_users

        items = search_mock_directory_users(q, limit=limit)
    elif settings.feishu_configured:
        client = FeishuClient(settings)
        try:
            items = await client.list_directory_users(q, limit=limit)
        finally:
            await client.close()
    else:
        items = []
    return success(items)


@router.get("/me")
async def me(
    user: User = Depends(get_current_user),
    authorization: str | None = Header(default=None),
):
    from app.auth.deps import _extract_bearer

    role_meta = None
    token = _extract_bearer(authorization)
    if token:
        entry = get_session_entry(token)
        if entry:
            role_meta = entry.role_meta or None
    return success(MeResponse(user=user, role_meta=role_meta).model_dump())


@router.post("/auth/feishu/login")
async def feishu_login(body: FeishuLoginRequest, settings: Settings = Depends(get_settings)):
    """飞书 H5 requestAuthCode 换取会话 token。"""
    try:
        user, role_meta = await exchange_code_for_user(body.code, settings)
    except HTTPException:
        raise
    except Exception as exc:
        raise _map_feishu_error(exc) from exc
    token = create_session(user, role_meta)
    return success({"token": token, "user": user.model_dump(), "role_meta": role_meta})


@router.get("/auth/feishu/callback")
async def feishu_callback(
    code: str = Query(...),
    settings: Settings = Depends(get_settings),
):
    """浏览器 OAuth 回调（可选）。"""
    user, role_meta = await exchange_code_for_user(code, settings)
    token = create_session(user, role_meta)
    return success({"token": token, "user": user.model_dump(), "role_meta": role_meta})


@router.get("/auth/jsapi-config")
async def jsapi_config(
    url: str = Query(..., description="当前页面 URL，不含 hash"),
    settings: Settings = Depends(get_settings),
):
    if not settings.feishu_configured:
        raise HTTPException(status_code=503, detail="飞书凭证未配置")
    if settings.mock_auth_enabled and settings.app_env == "dev":
        return success(
            {
                "appId": settings.feishu_app_id,
                "timestamp": 0,
                "nonceStr": "mock_nonce",
                "signature": "mock_signature",
                "url": url,
                "mock": True,
            }
        )
    try:
        client = FeishuClient(settings)
        config = await client.build_jsapi_config(url.split("#")[0])
        return success(config)
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


# health 探测结果缓存（避免每次请求都探测飞书 API）
_health_cache: dict = {}
_health_cache_at: float = 0.0
_HEALTH_CACHE_TTL = 30  # 秒


@router.get("/health")
async def health(settings: Settings = Depends(get_settings)):
    global _health_cache, _health_cache_at
    now = time.monotonic()
    if _health_cache and (now - _health_cache_at) < _HEALTH_CACHE_TTL:
        return _health_cache

    result: dict = {
        "status": "ok",
        "bitable_mode": settings.bitable_mode,
        "feishu_configured": settings.feishu_configured,
        "bitable_configured": settings.bitable_configured,
        "inventory_slots_enabled": settings.inventory_slots_enabled,
        "mock_auth_enabled": settings.mock_auth_enabled,
    }
    if settings.bitable_mode == "real" and settings.bitable_configured:
        try:
            from app.bitable.client import BYTableClient

            client = BYTableClient(settings)
            await client._tenant_token()
            result["bitable_live"] = True
        except Exception as exc:
            result["bitable_live"] = False
            err = str(exc)
            if "Server disconnected" in err or "RemoteProtocolError" in err:
                result["bitable_error"] = (
                    "飞书 API 连接中断（多为网络波动），请重试；若持续失败请检查本机能否访问 open.feishu.cn"
                )
            else:
                result["bitable_error"] = err

    if settings.feishu_configured:
        try:
            client = FeishuClient(settings)
            result["feishu_im"] = await asyncio.wait_for(client.probe_im_permissions(), timeout=5.0)
        except asyncio.TimeoutError:
            result["feishu_im"] = {"ok": False, "reason": "IM 权限探测超时（5s），不影响 Bitable 读写"}
        except Exception as exc:
            result["feishu_im"] = {"ok": False, "reason": str(exc)}

    _health_cache = result
    _health_cache_at = time.monotonic()
    return result


@router.get("/bootstrap")
async def bootstrap(
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    """首页启动包：一次请求返回分类、物料、库位等全部数据，省掉 4-5 次往返。"""
    from app.services.inventory import InventoryService

    svc = InventoryService(settings)
    categories, catalog, locs = await asyncio.gather(
        svc.list_categories(),
        svc.list_material_catalog(),
        svc.list_locations(),
    )
    return success({
        "categories": [c.model_dump(mode="json") for c in categories],
        "materials": [m.model_dump(mode="json") for m in catalog],
        "locations": [l.model_dump(mode="json") for l in locs],
    })
