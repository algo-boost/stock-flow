from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

import httpx

from app.config import Settings
from app.bitable.mock_store import get_mock_store

logger = logging.getLogger("stock-flow.bitable")

# 飞书 API 偶发断连时重试
_RETRYABLE = (
    httpx.RemoteProtocolError,
    httpx.ReadTimeout,
    httpx.ConnectTimeout,
    httpx.ConnectError,
    httpx.WriteError,
)


class BYTableClient:
    """Bitable 客户端：mock 内存模式 / real HTTP 模式。"""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.mode = settings.bitable_mode
        self._base = "https://open.feishu.cn/open-apis/bitable/v1"
        self._cached_token: str | None = None
        self._cached_token_expires = 0.0

    async def list_records(
        self,
        table_id: str,
        page_size: int = 500,
        *,
        retries: int = 3,
    ) -> list[dict[str, Any]]:
        if self.mode == "mock":
            return []
        if not table_id:
            return []
        token = await self._tenant_token()
        items: list[dict[str, Any]] = []
        page_token: str | None = None
        while True:
            params: dict[str, Any] = {"page_size": page_size}
            if page_token:
                params["page_token"] = page_token
            resp = await self._request(
                "GET",
                f"{self._base}/apps/{self.settings.bitable_app_token}/tables/{table_id}/records",
                token=token,
                params=params,
                action=f"读取表 {table_id} 失败",
                retries=retries,
            )
            payload = self._parse_response(resp, f"读取表 {table_id} 失败")
            data = payload.get("data") or {}
            page_items = data.get("items") or []
            if not isinstance(page_items, list):
                raise RuntimeError(f"读取表 {table_id} 失败: 返回 items 格式异常")
            items.extend(page_items)
            if not data.get("has_more"):
                break
            page_token = data.get("page_token")
            if not page_token:
                logger.warning("Bitable 表 %s 返回 has_more=true 但缺少 page_token，提前结束分页读取", table_id)
                break
        return items

    async def create_record(
        self,
        table_id: str,
        fields: dict[str, Any],
        *,
        user_id_type: str = "open_id",
    ) -> dict[str, Any]:
        if self.mode == "mock":
            return {"record_id": "mock", "fields": fields}
        token = await self._tenant_token()
        resp = await self._request(
            "POST",
            f"{self._base}/apps/{self.settings.bitable_app_token}/tables/{table_id}/records",
            token=token,
            params={"user_id_type": user_id_type},
            json={"fields": fields},
            action=f"写入表 {table_id} 失败",
        )
        payload = self._parse_response(resp, f"写入表 {table_id} 失败")
        return payload.get("data", {}).get("record", {})

    async def update_record(
        self,
        table_id: str,
        record_id: str,
        fields: dict[str, Any],
        *,
        user_id_type: str = "open_id",
    ) -> dict[str, Any]:
        if self.mode == "mock":
            return {"record_id": record_id, "fields": fields}
        token = await self._tenant_token()
        resp = await self._request(
            "PUT",
            f"{self._base}/apps/{self.settings.bitable_app_token}/tables/{table_id}/records/{record_id}",
            token=token,
            params={"user_id_type": user_id_type},
            json={"fields": fields},
            action=f"更新表 {table_id} 失败",
        )
        payload = self._parse_response(resp, f"更新表 {table_id} 失败")
        return payload.get("data", {}).get("record", {})

    async def delete_record(self, table_id: str, record_id: str) -> None:
        if self.mode == "mock":
            return
        token = await self._tenant_token()
        resp = await self._request(
            "DELETE",
            f"{self._base}/apps/{self.settings.bitable_app_token}/tables/{table_id}/records/{record_id}",
            token=token,
            action=f"删除表 {table_id} 记录失败",
        )
        self._parse_response(resp, f"删除表 {table_id} 记录失败")

    @property
    def mock_store(self):
        return get_mock_store()

    async def _tenant_token(self) -> str:
        if self._cached_token and time.time() < self._cached_token_expires - 60:
            return self._cached_token

        resp = await self._request(
            "POST",
            "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
            json={
                "app_id": self.settings.feishu_app_id,
                "app_secret": self.settings.feishu_app_secret,
            },
            action="获取 tenant_access_token 失败",
        )
        payload = self._parse_response(resp, "获取 tenant_access_token 失败")
        self._cached_token = payload["tenant_access_token"]
        self._cached_token_expires = time.time() + payload.get("expire", 7200)
        return self._cached_token

    async def _request(
        self,
        method: str,
        url: str,
        *,
        token: str | None = None,
        params: dict[str, Any] | None = None,
        json: dict[str, Any] | None = None,
        action: str,
        retries: int = 3,
    ) -> httpx.Response:
        last_exc: Exception | None = None
        headers = {"Authorization": f"Bearer {token}"} if token else None

        for attempt in range(retries):
            try:
                async with httpx.AsyncClient(timeout=30.0) as client:
                    resp = await client.request(
                        method,
                        url,
                        headers=headers,
                        params=params,
                        json=json,
                    )
                return resp
            except _RETRYABLE as exc:
                last_exc = exc
                logger.warning("Bitable 请求重试 %s/%s %s: %s", attempt + 1, retries, url, exc)
                if attempt + 1 < retries:
                    await asyncio.sleep(0.5 * (attempt + 1))

        raise RuntimeError(f"{action}: {last_exc}") from last_exc

    @staticmethod
    def _parse_response(resp: httpx.Response, action: str) -> dict[str, Any]:
        try:
            payload = resp.json()
        except Exception as exc:
            snippet = (resp.text or "")[:200]
            raise RuntimeError(f"{action}: HTTP {resp.status_code} {snippet}") from exc
        if payload.get("code") != 0:
            msg = payload.get("msg") or action
            raise RuntimeError(f"{action}: {msg}")
        return payload
