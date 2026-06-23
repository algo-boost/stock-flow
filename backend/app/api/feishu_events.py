"""飞书事件回调 — 审批结果通知。

接收路径：POST /api/feishu/events
飞书开放平台 → 事件订阅 → 请求网址 配置为该 URL。

完整的审批流程：
  用户在飞书「审批」中填写表单并提交
  → 审批人通过/拒绝
  → 飞书推送事件到此接口
  → 通过时：拉取审批表单数据 → 匹配物料/库位 → 直接执行出入库
  → 拒绝时：记录日志（无需额外操作）

注意：飞书审批实例本身即为"出入库申请"，无需预创建 Bitable 记录。
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Request

from app.config import Settings, get_settings

logger = logging.getLogger("stock-flow.feishu-events")

router = APIRouter(tags=["feishu-events"])

# ── 表单字段 ID（需与飞书审批定义中的控件 ID 一致） ──
FORM_MATERIAL = "widget_material"
FORM_QUANTITY = "widget_quantity"
FORM_TYPE = "widget_type"
FORM_LOCATION = "widget_location"
FORM_REASON = "widget_reason"


@router.post("/api/feishu/events")
async def feishu_event_callback(request: Request) -> dict[str, Any]:
    """飞书统一事件回调入口。

    首次配置事件订阅时飞书会发 challenge 验证请求。
    """
    body: dict[str, Any] = await request.json()

    # ── challenge 验证 ──
    if "challenge" in body:
        return {"challenge": body["challenge"]}

    settings = get_settings()
    header: dict[str, Any] = body.get("header", {})
    event_type: str = header.get("event_type", "")
    event: dict[str, Any] = body.get("event", {})

    logger.info("收到飞书事件 type=%s", event_type)

    # 只处理审批相关事件
    if event_type not in (
        "approval_instance.approve",
        "approval_instance.reject",
        "approval_instance.cancel",
    ):
        return {"code": 0}

    instance_id: str | None = event.get("instance_id")
    if not instance_id:
        logger.warning("事件缺少 instance_id")
        return {"code": 0}

    # 幂等：防止飞书重复推送
    from app.services.feishu_approval import FeishuApprovalClient

    if not FeishuApprovalClient.mark_processed(instance_id):
        logger.info("审批实例 %s 已处理过，跳过", instance_id)
        return {"code": 0}

    try:
        if event_type == "approval_instance.approve":
            await _handle_approved(instance_id, event, settings)
        elif event_type == "approval_instance.reject":
            await _handle_rejected(instance_id, event, settings)
        elif event_type == "approval_instance.cancel":
            await _handle_cancelled(instance_id, event, settings)
    except Exception:
        logger.exception("处理飞书事件失败 type=%s instance_id=%s", event_type, instance_id)
        # 返回 200，避免飞书重复推送；错误详情记日志

    return {"code": 0}


# ── 审批通过：解析表单 → 匹配物料 → 执行出入库 ──────────

async def _handle_approved(
    instance_id: str, event: dict[str, Any], settings: Settings
) -> None:
    """审批通过 → 拉取表单数据 → 直接执行库存变更。"""
    from app.services.feishu_approval import FeishuApprovalClient
    from app.services.inventory import InventoryService

    client = FeishuApprovalClient(settings)

    # 1. 拉取审批表单数据
    form = await client.parse_instance_form(instance_id)
    material_name = form.get(FORM_MATERIAL, "")
    quantity_str = form.get(FORM_QUANTITY, "0")
    request_type = form.get(FORM_TYPE, "").strip()
    location_name = form.get(FORM_LOCATION, "").strip()
    reason = form.get(FORM_REASON, "").strip()
    applicant_name = event.get("operate_name") or "飞书用户"
    applicant_open_id = event.get("operate_id") or "feishu_user"

    if not material_name or not request_type:
        logger.warning("审批表单数据不完整 instance_id=%s form=%s", instance_id, form)
        return

    try:
        quantity = int(quantity_str)
    except ValueError:
        logger.warning("数量格式错误: %s", quantity_str)
        return

    if quantity <= 0:
        return

    is_inbound = request_type in ("入库", "inbound", "in", "INBOUND")

    service = InventoryService(settings)

    # 2. 按名称或编码查找物料
    material_id = await _find_material_by_name(service, material_name)
    if not material_id:
        logger.warning(
            "飞书审批中的物料「%s」在 Bitable 中未找到 instance_id=%s",
            material_name, instance_id,
        )
        return

    # 3. 按名称查找库位（出库必须有库位）
    location_id: str | None = None
    if location_name and location_name != "待库管指定":
        location_id = await _find_location_by_name(service, location_name)
    if not is_inbound and not location_id:
        logger.warning("出库审批缺少库位 instance_id=%s", instance_id)
        return

    # 4. 执行出入库
    from app.models import InboundCreate, OutboundCreate, User

    operator = User(open_id=applicant_open_id, name=applicant_name, role="USER")
    idempotency_key = f"feishu_{instance_id}"

    if is_inbound:
        payload = InboundCreate(
            material_id=material_id,
            location_id=location_id or "",
            qty=quantity,
            idempotency_key=idempotency_key,
            note=reason or f"飞书审批入库 · {applicant_name}",
        )
        await service.inbound(payload, operator)
    else:
        # 出库需归还策略（审批表单里目前没这个字段，默认不归还）
        payload = OutboundCreate(
            material_id=material_id,
            location_id=location_id or "",
            qty=quantity,
            idempotency_key=idempotency_key,
            note=reason or f"飞书审批出库 · {applicant_name}",
            return_required=False,
        )
        await service.outbound(payload, operator)

    logger.info(
        "飞书审批通过 → %s 物料=%s qty=%d instance_id=%s",
        "入库" if is_inbound else "出库",
        material_name,
        quantity,
        instance_id,
    )


async def _handle_rejected(
    instance_id: str, event: dict[str, Any], settings: Settings
) -> None:
    """审批拒绝 → 仅记录日志（无库存变更）。"""
    reason = event.get("operate_comment") or "无"
    operator = event.get("operate_name") or "未知"
    logger.info("飞书审批已拒绝 instance_id=%s operator=%s reason=%s", instance_id, operator, reason)


async def _handle_cancelled(
    instance_id: str, event: dict[str, Any], settings: Settings
) -> None:
    """审批撤销 → 等同拒绝。"""
    logger.info("飞书审批已撤销 instance_id=%s", instance_id)


# ── helper：按名称匹配物料/库位 ─────────────────────────

async def _find_material_by_name(service, name: str) -> str | None:
    """按物料名称或编码查找物料 ID。"""
    # 遍历全部物料 catalog（数量少，性能可接受）
    try:
        catalog = await service.list_material_catalog()
        # 精确匹配
        for m in catalog:
            mn = m.material.name
            code = getattr(m.material, "code", "")
            if mn == name or code == name:
                return m.material.id
        # 模糊匹配
        lower_name = name.lower()
        for m in catalog:
            mn_lower = m.material.name.lower()
            if lower_name in mn_lower or mn_lower in lower_name:
                return m.material.id
    except Exception:
        pass
    return None


async def _find_location_by_name(service, name: str) -> str | None:
    """按库位名称查找库位 ID。"""
    try:
        locs = await service.list_locations()
        for loc in locs:
            if loc.name == name:
                return loc.id
        for loc in locs:
            if name.lower() in loc.name.lower() or loc.name.lower() in name.lower():
                return loc.id
    except Exception:
        pass
    return None
