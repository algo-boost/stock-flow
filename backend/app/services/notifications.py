"""飞书消息通知 — 审批流程消息推送。"""
from __future__ import annotations

import logging
from typing import Any

from app.config import Settings
from app.models import StockRequestResult

logger = logging.getLogger("stock-flow.notifications")


def _app_url(settings: Settings) -> str:
    return getattr(settings, "app_base_url", "") or ""


async def notify_new_request(
    request: StockRequestResult,
    approver_open_id: str | None,
    settings: Settings,
) -> None:
    """新申请 → 通知审批人。"""
    if not approver_open_id:
        logger.info("未指定审批人，跳过消息通知")
        return

    from app.services.feishu_client import FeishuClient
    client = FeishuClient(settings)
    base = _app_url(settings)
    link = f"{base}/manage?tab=approvals" if base else ""

    title = f"📋 新的{request.type}申请"
    lines = [
        f"**{request.requester_name}** 申请 **{request.type}**：",
        f"物料：{request.material_name or request.material_id}",
        f"数量：**{request.quantity}**",
    ]
    if request.remark:
        lines.append(f"说明：{request.remark}")

    await client.send_card_message(approver_open_id, title, lines, link, "去审批")


async def notify_request_approved(
    request: StockRequestResult,
    settings: Settings,
) -> None:
    """审批通过 → 通知申请人。"""
    recipient = request.requester_open_id
    if not recipient:
        return

    from app.services.feishu_client import FeishuClient
    client = FeishuClient(settings)
    base = _app_url(settings)
    link = f"{base}/history" if base else ""

    title = f"✅ {request.type}申请已通过"
    lines = [
        f"您的 **{request.type}** 申请已通过：",
        f"物料：{request.material_name or request.material_id}",
        f"数量：**{request.quantity}**",
    ]
    await client.send_card_message(recipient, title, lines, link, "查看流水")


async def notify_request_rejected(
    request: StockRequestResult,
    reason: str,
    settings: Settings,
) -> None:
    """审批拒绝 → 通知申请人。"""
    recipient = request.requester_open_id
    if not recipient:
        return

    from app.services.feishu_client import FeishuClient
    client = FeishuClient(settings)
    base = _app_url(settings)
    link = f"{base}/history" if base else ""

    title = f"❌ {request.type}申请已拒绝"
    lines = [
        f"您的 **{request.type}** 申请已被拒绝：",
        f"物料：{request.material_name or request.material_id}",
        f"数量：**{request.quantity}**",
        f"原因：{reason or '未说明'}",
    ]
    await client.send_card_message(recipient, title, lines, link, "查看详情")


async def _get_cc_open_ids(settings: Settings) -> list[str]:
    """获取所有抄送目标：管理员群成员 + 额外抄送人。"""
    ids: list[str] = []

    # 1. 从管理员群获取成员 open_id
    admin_chat = settings.feishu_group_admin
    if admin_chat:
        from app.services.feishu_client import FeishuClient
        client = FeishuClient(settings)
        try:
            group_members = await client.list_group_members(admin_chat)
            ids.extend(group_members)
            logger.info("管理员群成员 %d 人", len(group_members))
        except Exception:
            logger.warning("获取管理员群成员失败，使用环境变量兜底")

    # 2. 额外抄送人（上司等，open_id 逗号分隔）
    extra = getattr(settings, "feishu_cc_extra", "")
    for oid in extra.split(","):
        oid = oid.strip()
        if oid and oid not in ids:
            ids.append(oid)

    return ids


async def notify_request_cc(
    request: StockRequestResult,
    approver_open_id: str | None,
    settings: Settings,
) -> None:
    """新申请 → 抄送所有管理员（除审批人外）。"""
    if not getattr(settings, "feishu_cc_enabled", True):
        return

    admins = await _get_cc_open_ids(settings)
    if not admins:
        return

    from app.services.feishu_client import FeishuClient
    client = FeishuClient(settings)
    base = _app_url(settings)
    link = f"{base}/manage?tab=approvals" if base else ""

    title = f"📋 {request.type}申请 · 抄送"
    lines = [
        f"**{request.requester_name}** 申请 **{request.type}**：",
        f"物料：{request.material_name or request.material_id}",
        f"数量：**{request.quantity}**",
    ]
    if request.remark:
        lines.append(f"说明：{request.remark}")

    for oid in admins:
        if oid == approver_open_id:
            continue  # 跳过审批人本人
        try:
            await client.send_card_message(oid, title, lines, link, "查看详情")
        except Exception:
            logger.warning("抄送失败 open_id=%s", oid)
