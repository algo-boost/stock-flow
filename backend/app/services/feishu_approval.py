"""飞书审批（Approval）API 客户端。

飞书原生审批流程（完整闭环）：
1. 用户在飞书审批中填写「出入库申请」表单并提交
2. 审批人（管理员/库管）在飞书审批中通过或拒绝
3. 飞书回调 POST /api/feishu/events → 通知审批结果
4. 后端拉取审批表单数据 → 直接执行库存变更（入库/出库）
5. Bitable 流水与库存自动更新
"""

from __future__ import annotations

import logging
import time
from typing import Any

import httpx

from app.config import Settings

FEISHU_BASE = "https://open.feishu.cn/open-apis"

logger = logging.getLogger("stock-flow.approval")


class FeishuApprovalClient:
    """飞书审批 API 薄封装。"""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._tenant_token: str | None = None
        self._tenant_token_expires = 0.0

    # ── token ──────────────────────────────────────────────

    async def _get_tenant_token(self) -> str:
        """获取/缓存 tenant_access_token（审批 API 必需）。"""
        now = time.time()
        if self._tenant_token and now < self._tenant_token_expires - 60:
            return self._tenant_token

        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(
                f"{FEISHU_BASE}/auth/v3/tenant_access_token/internal",
                json={
                    "app_id": self.settings.feishu_app_id,
                    "app_secret": self.settings.feishu_app_secret,
                },
            )
            resp.raise_for_status()
            payload: dict[str, Any] = resp.json()
            if payload.get("code") != 0:
                raise RuntimeError(payload.get("msg", "获取 tenant_access_token 失败"))
            token: str = payload["tenant_access_token"]
            self._tenant_token = token
            self._tenant_token_expires = now + payload.get("expire", 7200)
            return token

    async def _post(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        token = await self._get_tenant_token()
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(
                f"{FEISHU_BASE}{path}",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                json=body,
            )
            payload: dict[str, Any] = resp.json()
            if payload.get("code") != 0:
                raise RuntimeError(payload.get("msg") or f"审批 API 调用失败 ({path})")
            return payload

    # ── 审批定义 ───────────────────────────────────────────

    async def list_definitions(self) -> list[dict[str, Any]]:
        """列出当前应用可见的审批定义（用于获取 approval_code）。"""
        payload = await self._post(
            "/approval/v4/definitions",
            {"page_size": 50},
        )
        return payload.get("data", {}).get("approval_definition_list", [])

    async def get_definition(self, approval_code: str) -> dict[str, Any]:
        """获取单个审批定义详情，包含表单字段结构。"""
        payload = await self._post(
            "/approval/v4/definitions/search",
            {"approval_code": approval_code, "locale": "zh-CN"},
        )
        data = payload.get("data", {})
        # 返回第一个匹配结果
        items = data.get("approval_definition_list") or []
        if not items:
            raise RuntimeError(f"未找到审批定义: {approval_code}")
        return items[0]

    # ── 审批实例 ───────────────────────────────────────────

    async def create_instance(
        self,
        approval_code: str,
        open_id: str,
        form_values: list[dict[str, Any]],
        instance_code: str,
        title: str = "",
    ) -> str:
        """创建审批实例。

        Args:
            approval_code: 审批定义 code（飞书管理后台创建后获取）
            open_id: 申请人 open_id
            form_values: 表单字段值列表
            instance_code: 业务唯一标识（用于回调匹配，建议用 request.id）
            title: 审批标题（可选）

        Returns:
            Feishu 审批实例 ID（instance_id）
        """
        body: dict[str, Any] = {
            "approval_code": approval_code,
            "open_id": open_id,
            "form": form_values,
            "instance_code": instance_code,
        }
        if title:
            body["title"] = title

        payload = await self._post("/approval/v4/instances", body)
        instance_id: str = payload["data"]["instance_id"]
        logger.info(
            "飞书审批实例已创建 instance_id=%s instance_code=%s", instance_id, instance_code,
        )
        return instance_id

    async def get_instance(self, instance_id: str) -> dict[str, Any]:
        """查询审批实例详情与当前状态。"""
        payload = await self._post(
            "/approval/v4/instances/get",
            {"instance_id": instance_id, "locale": "zh-CN"},
        )
        return payload.get("data", {})

    # ── 审批表单构建辅助 ──────────────────────────────────

    def build_form_values(
        self,
        *,
        material_name: str,
        quantity: int,
        request_type: str,
        location_name: str | None,
        reason: str,
    ) -> list[dict[str, Any]]:
        """构建审批表单字段值。

        字段 ID 需要与飞书管理后台创建的审批定义表单字段对应。
        默认字段 ID 约定（可在飞书后台自定义）：
          - widget_material: 物料名称（输入框，只读）
          - widget_quantity: 数量（数字，只读）
          - widget_type: 申请类型（输入框，只读）
          - widget_location: 库位（输入框，只读）
          - widget_reason: 申请原因（多行文本，只读）
        """
        return [
            {"id": "widget_material", "type": "input", "value": material_name},
            {"id": "widget_quantity", "type": "input", "value": str(quantity)},
            {"id": "widget_type", "type": "input", "value": request_type},
            {"id": "widget_location", "type": "input", "value": location_name or "待库管指定"},
            {"id": "widget_reason", "type": "textarea", "value": reason or ""},
        ]

    # ── 逆向解析（从审批实例提取表单数据） ──────────────────

    async def parse_instance_form(
        self, instance_id: str
    ) -> dict[str, str]:
        """从飞书审批实例中提取表单字段值。

        拉取审批实例详情，将 form 数组转为 {widget_id: value} 字典。
        字段 ID 需与飞书管理后台创建审批定义时的控件 ID 一致。
        """
        instance = await self.get_instance(instance_id)
        form_list: list[dict[str, Any]] = instance.get("form", [])
        result: dict[str, str] = {}
        for item in form_list:
            widget_id = item.get("id", "")
            value = item.get("value", "")
            if isinstance(value, list):
                value = ", ".join(str(v) for v in value)
            result[widget_id] = str(value).strip()
        return result

    # ── 幂等检查 ───────────────────────────────────────────

    _processed_instances: set[str] = set()

    @classmethod
    def mark_processed(cls, instance_id: str) -> bool:
        """标记审批实例已处理，返回 True 表示首次处理。"""
        if instance_id in cls._processed_instances:
            return False
        cls._processed_instances.add(instance_id)
        return True
