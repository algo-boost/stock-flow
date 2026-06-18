from __future__ import annotations

import hashlib
import asyncio
import logging
import secrets
import time
from typing import Any

import httpx

from app.config import Settings
from app.models import Role, User

FEISHU_BASE = "https://open.feishu.cn/open-apis"
PERMISSION_DENIED_CODE = 99991672
BOT_NOT_ENABLED_CODE = 232025
logger = logging.getLogger("stock-flow.feishu")

_role_check_status: dict[str, Any] = {}
_app_token_cache: dict[str, tuple[str, float]] = {}
_tenant_token_cache: dict[str, tuple[str, float]] = {}
_jsapi_ticket_cache: dict[str, tuple[str, float]] = {}
_role_cache: dict[str, tuple[float, Role, dict[str, Any]]] = {}


def get_role_check_status() -> dict[str, Any]:
    return dict(_role_check_status)


def _permission_url(app_id: str) -> str:
    scopes = "im:chat:readonly,im:chat.members:read"
    return f"https://open.feishu.cn/app/{app_id}/auth?q={scopes}&op_from=openapi"


def _set_role_check_status(ok: bool, meta: dict[str, Any]) -> None:
    global _role_check_status
    _role_check_status = {"ok": ok, **meta}


class FeishuClient:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._tenant_token: str | None = None
        self._tenant_token_expires = 0.0
        self._app_token: str | None = None
        self._app_token_expires = 0.0
        self._jsapi_ticket: str | None = None
        self._jsapi_ticket_expires = 0.0

    async def get_app_access_token(self) -> str:
        """网页应用免登换 user_access_token 须用 app_access_token。"""
        cache_key = self.settings.feishu_app_id
        cached = _app_token_cache.get(cache_key)
        if cached and time.time() < cached[1] - 60:
            return cached[0]

        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(
                f"{FEISHU_BASE}/auth/v3/app_access_token/internal",
                json={
                    "app_id": self.settings.feishu_app_id,
                    "app_secret": self.settings.feishu_app_secret,
                },
            )
            resp.raise_for_status()
            payload = resp.json()
            if payload.get("code") != 0:
                raise RuntimeError(payload.get("msg", "获取 app_access_token 失败"))
            token = payload["app_access_token"]
            _app_token_cache[cache_key] = (token, time.time() + payload.get("expire", 7200))
            return token

    async def get_tenant_access_token(self) -> str:
        cache_key = self.settings.feishu_app_id
        cached = _tenant_token_cache.get(cache_key)
        if cached and time.time() < cached[1] - 60:
            return cached[0]

        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(
                f"{FEISHU_BASE}/auth/v3/tenant_access_token/internal",
                json={
                    "app_id": self.settings.feishu_app_id,
                    "app_secret": self.settings.feishu_app_secret,
                },
            )
            resp.raise_for_status()
            payload = resp.json()
            if payload.get("code") != 0:
                raise RuntimeError(payload.get("msg", "获取 tenant_access_token 失败"))
            token = payload["tenant_access_token"]
            _tenant_token_cache[cache_key] = (token, time.time() + payload.get("expire", 7200))
            return token

    async def exchange_code_for_user(self, code: str) -> tuple[User, dict[str, Any]]:
        app_token = await self.get_app_access_token()
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(
                f"{FEISHU_BASE}/authen/v1/access_token",
                headers={"Authorization": f"Bearer {app_token}"},
                json={"grant_type": "authorization_code", "code": code},
            )
            payload = self._parse_feishu_response(resp, "免登 code 换 token 失败")
            data = payload.get("data") or {}
            user_access_token = data.get("access_token")
            if not user_access_token:
                raise RuntimeError("免登响应缺少 access_token")

            info_resp = await client.get(
                f"{FEISHU_BASE}/authen/v1/user_info",
                headers={"Authorization": f"Bearer {user_access_token}"},
            )
            info_payload = self._parse_feishu_response(info_resp, "获取用户信息失败")
            user_data = info_payload.get("data") or {}
            open_id = user_data.get("open_id") or user_data.get("user_id", "")
            name = user_data.get("name") or user_data.get("en_name") or open_id

        role, role_meta = await self.resolve_role_with_meta(open_id, user_access_token)
        user = User(open_id=open_id, name=name, role=role)
        return user, role_meta

    @staticmethod
    def _parse_feishu_response(resp: httpx.Response, action: str) -> dict[str, Any]:
        try:
            payload = resp.json()
        except Exception as exc:
            snippet = (resp.text or "")[:200]
            raise RuntimeError(f"{action}: HTTP {resp.status_code} {snippet}") from exc
        if payload.get("code") != 0:
            raise RuntimeError(payload.get("msg") or action)
        return payload

    def _override_role(self, open_id: str) -> Role | None:
        return self.settings.feishu_role_override_map.get(open_id)

    async def resolve_role_with_meta(
        self, open_id: str, user_access_token: str
    ) -> tuple[Role, dict[str, Any]]:
        cached = _role_cache.get(open_id)
        if cached and time.time() < cached[0]:
            role, meta = cached[1], cached[2]
            _set_role_check_status(True, meta)
            return role, meta

        override = self._override_role(open_id)
        if override:
            meta = {"source": "override", "method": "env", "warning": None}
            _set_role_check_status(True, meta)
            self._remember_role(open_id, override, meta)
            return override, meta

        group_checks = [
            (self.settings.feishu_group_admin, Role.ADMIN),
            (self.settings.feishu_group_keeper, Role.KEEPER),
            (self.settings.feishu_group_user, Role.USER),
        ]
        configured = [cid for cid, _ in group_checks if cid]
        if not configured:
            meta = {"source": "default", "method": "no_group_config", "warning": None}
            _set_role_check_status(True, meta)
            self._remember_role(open_id, Role.USER, meta)
            return Role.USER, meta

        permission_error: dict[str, Any] | None = None

        # 优先：用户 token + is_in_chat（并发判断当前登录用户是否在群内）
        checks = [(chat_id, role) for chat_id, role in group_checks if chat_id]
        check_results = await asyncio.gather(
            *(self._check_is_in_chat(user_access_token, chat_id) for chat_id, _ in checks)
        )
        for (chat_id, role), (in_chat, err) in zip(checks, check_results):
            if err:
                if err.get("code") == PERMISSION_DENIED_CODE:
                    permission_error = err
                    break
                logger.warning("用户 is_in_chat 失败 chat_id=%s: %s", chat_id, err.get("message"))
                continue
            if in_chat:
                meta = {"source": "group", "method": "user_is_in_chat", "warning": None}
                _set_role_check_status(True, meta)
                self._remember_role(open_id, role, meta)
                return role, meta

        # 兜底：tenant token 拉成员列表（需机器人入群 + 租户权限）
        tenant_token = await self.get_tenant_access_token()
        for chat_id, role in group_checks:
            if not chat_id:
                continue
            if await self._is_member_by_list(open_id, chat_id, tenant_token):
                meta = {"source": "group", "method": "tenant_members", "warning": None}
                _set_role_check_status(True, meta)
                self._remember_role(open_id, role, meta)
                return role, meta

        if permission_error:
            warning = (
                "无法读取飞书群组权限，已降级为普通用户。"
                "请在开放平台开通 im:chat:readonly 与 im:chat.members:read 并发布应用，"
                "同时确认机器人已加入角色群组。"
            )
            meta = {
                "source": "default",
                "method": None,
                "warning": warning,
                "permission_url": permission_error.get("permission_url"),
                "error_code": permission_error.get("code"),
            }
            _set_role_check_status(False, meta)
            logger.error("群组角色判定失败 open_id=%s: %s", open_id, warning)
            self._remember_role(open_id, Role.USER, meta)
            return Role.USER, meta

        meta = {
            "source": "default",
            "method": "group_miss",
            "warning": None,
        }
        _set_role_check_status(True, meta)
        self._remember_role(open_id, Role.USER, meta)
        return Role.USER, meta

    def _remember_role(self, open_id: str, role: Role, meta: dict[str, Any]) -> None:
        ttl = max(self.settings.feishu_role_cache_ttl_seconds, 0)
        if ttl <= 0:
            return
        _role_cache[open_id] = (time.time() + ttl, role, meta)

    async def _check_is_in_chat(
        self, access_token: str, chat_id: str
    ) -> tuple[bool | None, dict[str, Any] | None]:
        async with httpx.AsyncClient(timeout=20.0) as client:
            try:
                resp = await client.get(
                    f"{FEISHU_BASE}/im/v1/chats/{chat_id}/members/is_in_chat",
                    headers={"Authorization": f"Bearer {access_token}"},
                )
            except httpx.HTTPError as exc:
                logger.warning("is_in_chat 网络异常 chat_id=%s: %s", chat_id, exc)
                return None, {"message": str(exc)}

            try:
                payload = resp.json()
            except Exception:
                return None, {"message": f"非 JSON 响应 HTTP {resp.status_code}"}

            if payload.get("code") != 0:
                return None, self._parse_im_error(payload)

            return bool(payload.get("data", {}).get("is_in_chat")), None

    def _parse_im_error(self, payload: dict[str, Any]) -> dict[str, Any]:
        code = payload.get("code")
        msg = payload.get("msg") or "IM API 错误"
        app_id = self.settings.feishu_app_id
        if code == PERMISSION_DENIED_CODE:
            return {
                "code": code,
                "message": msg,
                "permission_url": _permission_url(app_id),
                "hint": "应用未开通或未发布 IM 权限（im:chat:readonly / im:chat.members:read）",
            }
        if code == BOT_NOT_ENABLED_CODE:
            return {
                "code": code,
                "message": msg,
                "hint": "开发者后台需添加「机器人」能力并发布应用",
            }
        return {"code": code, "message": msg}

    async def _is_member_by_list(self, open_id: str, chat_id: str, tenant_token: str) -> bool:
        if not chat_id or not open_id:
            return False
        page_token: str | None = None
        async with httpx.AsyncClient(timeout=20.0) as client:
            while True:
                params: dict[str, Any] = {"member_id_type": "open_id", "page_size": 100}
                if page_token:
                    params["page_token"] = page_token
                try:
                    resp = await client.get(
                        f"{FEISHU_BASE}/im/v1/chats/{chat_id}/members",
                        headers={"Authorization": f"Bearer {tenant_token}"},
                        params=params,
                    )
                except httpx.HTTPError as exc:
                    logger.warning("群成员查询网络异常 chat_id=%s: %s", chat_id, exc)
                    return False

                try:
                    payload = resp.json()
                except Exception:
                    logger.warning("群成员响应非 JSON chat_id=%s", chat_id)
                    return False

                if payload.get("code") != 0:
                    err = self._parse_im_error(payload)
                    logger.warning(
                        "群成员 API 错误 chat_id=%s code=%s hint=%s",
                        chat_id,
                        err.get("code"),
                        err.get("hint") or err.get("message"),
                    )
                    return False

                data = payload.get("data", {})
                for item in data.get("items", []):
                    mid = item.get("member_id") or item.get("open_id")
                    if mid == open_id:
                        return True
                if not data.get("has_more"):
                    break
                page_token = data.get("page_token")
        return False

    async def probe_im_permissions(self) -> dict[str, Any]:
        """健康检查：验证 tenant token 能否调用 IM 接口（机器人是否在群内）。"""
        chat_id = (
            self.settings.feishu_group_admin
            or self.settings.feishu_group_keeper
            or self.settings.feishu_group_user
        )
        if not chat_id:
            return {
                "ok": True,
                "reason": "未配置 FEISHU_GROUP_* chat_id，默认按 USER 权限处理",
            }

        try:
            tenant_token = await self.get_tenant_access_token()
        except Exception as exc:
            return {"ok": False, "reason": f"获取 tenant_access_token 失败: {exc}"}

        in_chat, err = await self._check_is_in_chat(tenant_token, chat_id)
        if err:
            return {
                "ok": False,
                "chat_id": chat_id,
                "error_code": err.get("code"),
                "error": err.get("hint") or err.get("message"),
                "permission_url": err.get("permission_url"),
            }
        return {
            "ok": True,
            "chat_id": chat_id,
            "bot_in_chat": in_chat,
            "hint": None
            if in_chat
            else "IM 权限已通，但机器人未加入该群；请将应用机器人拉入 ADMIN/KEEPER/USER 角色群",
        }

    async def build_jsapi_config(self, url: str) -> dict[str, Any]:
        tenant_token = await self.get_tenant_access_token()
        ticket = await self._get_jsapi_ticket(tenant_token)
        nonce = secrets.token_hex(8)
        timestamp = int(time.time())
        sign_str = f"jsapi_ticket={ticket}&noncestr={nonce}&timestamp={timestamp}&url={url}"
        signature = hashlib.sha1(sign_str.encode("utf-8")).hexdigest()
        return {
            "appId": self.settings.feishu_app_id,
            "timestamp": timestamp,
            "nonceStr": nonce,
            "signature": signature,
            "url": url,
        }

    async def _get_jsapi_ticket(self, tenant_token: str) -> str:
        cache_key = self.settings.feishu_app_id
        cached = _jsapi_ticket_cache.get(cache_key)
        if cached and time.time() < cached[1] - 60:
            return cached[0]

        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(
                f"{FEISHU_BASE}/jssdk/ticket/get",
                headers={"Authorization": f"Bearer {tenant_token}"},
                json={},
            )
            resp.raise_for_status()
            payload = resp.json()
            if payload.get("code") != 0:
                raise RuntimeError(payload.get("msg", "获取 jsapi_ticket 失败"))
            data = payload["data"]
            ticket = data["ticket"]
            _jsapi_ticket_cache[cache_key] = (ticket, time.time() + data.get("expire_in", 7200))
            return ticket
