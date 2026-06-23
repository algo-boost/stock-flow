"""Bitable HTTP 客户端 —— 共享连接池 + 重试 + 分页"""
from __future__ import annotations
import asyncio, logging, time
import httpx
from app.config import Settings

logger = logging.getLogger("scaffold.bitable")

_RETRYABLE = (httpx.ConnectError, httpx.ReadTimeout, httpx.RemoteProtocolError)


class BYTableClient:
    def __init__(self, settings: Settings):
        self.settings = settings
        self._base = "https://open.feishu.cn/open-apis/bitable/v1"
        self._token: str | None = None
        self._token_expires = 0.0
        self._http: httpx.AsyncClient | None = None

    async def _ensure_http(self) -> httpx.AsyncClient:
        if self._http is None:
            self._http = httpx.AsyncClient(
                timeout=httpx.Timeout(15.0, connect=8.0),
                limits=httpx.Limits(max_keepalive_connections=4, max_connections=10))
        return self._http

    async def close(self):
        if self._http:
            await self._http.aclose()
            self._http = None

    async def _tenant_token(self) -> str:
        if self._token and time.time() < self._token_expires - 60:
            return self._token
        resp = await self._request("POST",
            "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
            json={"app_id": self.settings.feishu_app_id, "app_secret": self.settings.feishu_app_secret},
            action="获取 tenant_access_token 失败")
        payload = resp.json()
        if payload.get("code") != 0:
            raise RuntimeError(f"获取 tenant_access_token 失败: {payload.get('msg')}")
        self._token = payload["tenant_access_token"]
        self._token_expires = time.time() + payload.get("expire", 7200)
        return self._token

    async def list_records(self, table_id: str, page_size: int = 500, retries: int = 3) -> list[dict]:
        if not table_id:
            return []
        token = await self._tenant_token()
        items, page_token = [], None
        while True:
            params = {"page_size": page_size}
            if page_token:
                params["page_token"] = page_token
            resp = await self._request("GET",
                f"{self._base}/apps/{self.settings.bitable_app_token}/tables/{table_id}/records",
                token=token, params=params, action=f"读取表 {table_id} 失败", retries=retries)
            data = resp.json()
            if data.get("code") != 0:
                raise RuntimeError(f"读取表 {table_id} 失败: {data.get('msg')}")
            items.extend((data.get("data") or {}).get("items") or [])
            if not (data.get("data") or {}).get("has_more"):
                break
            page_token = (data.get("data") or {}).get("page_token")
            if not page_token:
                break
        return items

    async def create_record(self, table_id: str, fields: dict) -> dict:
        token = await self._tenant_token()
        resp = await self._request("POST",
            f"{self._base}/apps/{self.settings.bitable_app_token}/tables/{table_id}/records",
            token=token, params={"user_id_type": "open_id"}, json={"fields": fields},
            action=f"写入表 {table_id} 失败")
        data = resp.json()
        if data.get("code") != 0:
            raise RuntimeError(f"写入表 {table_id} 失败: {data.get('msg')}")
        return data["data"]["record"]

    async def update_record(self, table_id: str, record_id: str, fields: dict) -> dict:
        token = await self._tenant_token()
        resp = await self._request("PUT",
            f"{self._base}/apps/{self.settings.bitable_app_token}/tables/{table_id}/records/{record_id}",
            token=token, params={"user_id_type": "open_id"}, json={"fields": fields},
            action=f"更新表 {table_id} 失败")
        data = resp.json()
        if data.get("code") != 0:
            raise RuntimeError(f"更新表 {table_id} 失败: {data.get('msg')}")
        return data["data"]["record"]

    async def _request(self, method: str, url: str, *, token: str | None = None,
                       action: str = "", retries: int = 3, **kwargs) -> httpx.Response:
        """带重试的 HTTP 请求，复用 _http 连接池。"""
        http = await self._ensure_http()
        headers = {"Authorization": f"Bearer {token}"} if token else None
        for attempt in range(retries):
            try:
                return await http.request(method, url, headers=headers, **kwargs)
            except _RETRYABLE as exc:
                logger.warning("Bitable 重试 %s/%s %s: %s", attempt + 1, retries, url, exc)
                if attempt + 1 < retries:
                    await asyncio.sleep(0.5 * (attempt + 1))
        raise RuntimeError(f"{action}: 重试 {retries} 次均失败")
