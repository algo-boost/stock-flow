from __future__ import annotations

import logging

from app.bitable.repository import BitableRepository
from app.bitable.mock_store import get_mock_store
from app.config import Settings
from app.models import (
    Category,
    CategoryCreate,
    CategoryUpdate,
    InboundCreate,
    InventoryItem,
    InventoryRecordUpdate,
    InventorySlotUpdate,
    Location,
    LocationCreate,
    LocationUpdate,
    LowStockItem,
    Material,
    MaterialCreate,
    MaterialDetail,
    MaterialUpdate,
    OutboundCreate,
    PaginatedMaterials,
    PurchaseInboundCreate,
    RequestApprove,
    RequestReject,
    StockRequest,
    StockRequestCreate,
    StockRequestStatus,
    StockRequestUpdate,
    Transaction,
    TransactionUpdate,
    TransferCreate,
    User,
)
from app.services.pending_returns import compute_pending_returns
from app.utils.categories import attach_category_stats
from app.utils.inventory_display import format_inventory_summary
from app.utils.request_remark import format_outbound_remark
from app.utils.response import AppError

logger = logging.getLogger("stock-flow.inventory")


def _wrap_bitable_error(exc: Exception) -> AppError:
    msg = str(exc) or "Bitable 读写失败"
    if "TableIdNotFound" in msg:
        return AppError(
            5002,
            "Bitable 表 ID 无效，请检查 backend/.env 中 BITABLE_TABLE_* 是否与多维表格一致",
            500,
        )
    if "WrongAppToken" in msg or "app_token" in msg.lower():
        return AppError(5002, "Bitable app_token 无效，请使用 /base/ 链接中的 ID", 500)
    if "FieldNameNotFound" in msg:
        return AppError(
            5002,
            "Bitable 字段名不匹配，请检查 backend/.env 中 BITABLE_F_* 是否与多维表格列名一致",
            500,
        )
    if msg == "category_crud_requires_mock_or_bitable_parent_field":
        return AppError(
            5002,
            "分类增删尚未生效，请重启后端（8002）后再试；若仍失败，请检查 categories 表是否有「父分类ID」列",
            500,
        )
    if msg == "category_parent_field_not_configured":
        return AppError(
            5002,
            "未配置父分类字段，请在 backend/.env 设置 BITABLE_F_CATEGORY_PARENT=父分类ID",
            500,
        )
    return AppError(5002, msg, 500)


def _wrap_data_error(area: str, exc: Exception) -> AppError:
    return AppError(5003, f"{area}数据格式或字段配置错误: {type(exc).__name__}: {exc}", 500)


def _user_owns_transaction(tx: Transaction, user_name: str) -> bool:
    if tx.operator == user_name:
        return True
    remark = tx.remark or ""
    return f"申请人: {user_name}" in remark or f"操作人: {user_name}" in remark


class InventoryService:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.store = get_mock_store()
        self.repo = BitableRepository(settings) if settings.bitable_mode == "real" else None

    async def search_materials(
        self,
        q: str | None,
        search_by: str,
        category: str | None,
        location: str | None,
        stock_only: bool,
        page: int,
        size: int,
    ) -> PaginatedMaterials:
        try:
            if self.repo:
                items, total = await self.repo.search_materials(
                    q,
                    search_by,
                    category,
                    location,
                    stock_only,
                    page,
                    size,
                )
            else:
                items, total = self.store.search_materials(
                    q,
                    search_by,
                    category,
                    location,
                    stock_only,
                    page,
                    size,
                )
        except RuntimeError as exc:
            raise _wrap_bitable_error(exc) from exc
        except Exception as exc:
            raise _wrap_data_error("Bitable 物料/库存表", exc) from exc
        return PaginatedMaterials(items=items, total=total, page=page, size=size)

    async def list_categories(self) -> list[Category]:
        try:
            if self.repo:
                categories = await self.repo.list_categories()
                materials = list((await self.repo._load_materials()).values())
                inventory_map = await self.repo._load_inventory_map()
            else:
                categories = self.store.list_categories()
                materials = list(self.store.materials.values())
                inventory_map = {
                    key: item.quantity for key, item in self.store.inventory.items()
                }
            stock_by_material: dict[str, int] = {}
            for key, quantity in inventory_map.items():
                material_id = key[0]
                stock_by_material[material_id] = stock_by_material.get(material_id, 0) + quantity
            return attach_category_stats(categories, materials, stock_by_material)
        except RuntimeError as exc:
            raise _wrap_bitable_error(exc) from exc
        except Exception as exc:
            raise _wrap_data_error("Bitable 分类表", exc) from exc

    async def create_category(self, payload: CategoryCreate) -> Category:
        try:
            if self.repo:
                return await self.repo.create_category(payload)
            return self.store.create_category(payload)
        except ValueError as exc:
            msg = str(exc)
            if msg == "parent_not_found":
                raise AppError(1001, "上级分类不存在", 400) from exc
            if msg == "category_name_exists":
                raise AppError(1001, "同级分类名称已存在", 400) from exc
            raise
        except RuntimeError as exc:
            raise _wrap_bitable_error(exc) from exc
        except Exception as exc:
            raise _wrap_data_error("Bitable 分类表", exc) from exc

    async def delete_category(self, category_id: str) -> None:
        try:
            if self.repo:
                await self.repo.delete_category(category_id)
                return
            self.store.delete_category(category_id)
        except ValueError as exc:
            msg = str(exc)
            if msg == "category_not_found":
                raise AppError(1001, "分类不存在", 404) from exc
            if msg.startswith("category_in_use"):
                detail = "顶层分类下仍有物料，请先在物料详情中修改分类后再删除"
                if not self.repo:
                    raw = msg.split(":", 1)
                    if len(raw) == 2 and raw[1]:
                        detail = f"分类已被物料使用，无法删除（关联：{raw[1].replace(',', '、')}）"
                raise AppError(1001, detail, 400) from exc
            raise
        except RuntimeError as exc:
            raise _wrap_bitable_error(exc) from exc
        except Exception as exc:
            raise _wrap_data_error("Bitable 分类表", exc) from exc

    async def update_category(self, category_id: str, payload: CategoryUpdate) -> Category:
        try:
            if self.repo:
                return await self.repo.update_category(category_id, payload)
            return self.store.update_category(category_id, payload)
        except ValueError as exc:
            msg = str(exc)
            if msg == "category_not_found":
                raise AppError(1001, "分类不存在", 404) from exc
            if msg == "parent_not_found":
                raise AppError(1001, "上级分类不存在", 400) from exc
            if msg == "category_name_exists":
                raise AppError(1001, "同级分类名称已存在", 400) from exc
            if msg == "category_self_parent":
                raise AppError(1001, "不能将自己设为父分类", 400) from exc
            raise
        except RuntimeError as exc:
            raise _wrap_bitable_error(exc) from exc
        except Exception as exc:
            raise _wrap_data_error("Bitable 分类表", exc) from exc

    async def create_material(self, payload: MaterialCreate) -> Material:
        try:
            if self.repo:
                return await self.repo.create_material(payload)
            return self.store.create_material(payload)
        except ValueError as exc:
            msg = str(exc)
            if msg == "category_not_found":
                raise AppError(1001, "分类未找到", 400) from exc
            if msg == "location_not_found":
                raise AppError(1001, "默认库位未找到", 400) from exc
            raise
        except RuntimeError as exc:
            raise _wrap_bitable_error(exc) from exc

    async def update_material(self, material_id: str, payload: MaterialUpdate) -> Material:
        try:
            if self.repo:
                return await self.repo.update_material(material_id, payload)
            return self.store.update_material(material_id, payload)
        except ValueError as exc:
            msg = str(exc)
            if msg == "material_not_found":
                raise AppError(4004, "物料未找到", 404) from exc
            if msg == "category_not_found":
                raise AppError(1001, "分类未找到", 400) from exc
            if msg == "location_not_found":
                raise AppError(1001, "默认库位未找到", 400) from exc
            raise
        except RuntimeError as exc:
            raise _wrap_bitable_error(exc) from exc

    async def delete_material(self, material_id: str) -> None:
        try:
            if self.repo:
                await self.repo.delete_material(material_id)
            else:
                self.store.delete_material(material_id)
        except ValueError as exc:
            msg = str(exc)
            if msg == "material_not_found":
                raise AppError(4004, "物料未找到", 404) from exc
            if msg.startswith("material_has_stock:"):
                stock = msg.split(":", 1)[1]
                raise AppError(4003, f"物料仍有库存 {stock}，请先出库或移动后再删除", 400) from exc
            if msg == "material_has_transactions":
                raise AppError(4003, "物料已有出入库流水或申请记录，不能删除", 400) from exc
            if msg == "material_has_requests":
                raise AppError(4003, "物料仍有出入库申请，不能删除", 400) from exc
            raise
        except RuntimeError as exc:
            raise _wrap_bitable_error(exc) from exc

    async def get_material_detail(self, material_id: str) -> MaterialDetail:
        try:
            if self.repo:
                material = await self.repo.get_material(material_id)
                if not material:
                    raise AppError(4004, "物料未找到", 404)
                inventory = await self.repo.get_inventory_for_material(material_id)
            else:
                material = self.store.get_material(material_id)
                if not material:
                    raise AppError(4004, "物料未找到", 404)
                inventory = self.store.get_inventory_for_material(material_id)
        except AppError:
            raise
        except RuntimeError as exc:
            raise _wrap_bitable_error(exc) from exc
        except Exception as exc:
            raise _wrap_data_error("Bitable 物料详情/库存表", exc) from exc
        total = sum(i.quantity for i in inventory)
        return MaterialDetail(material=material, inventory=inventory, total_quantity=total)

    async def list_material_catalog(
        self,
        q: str | None = None,
        stock_only: bool = False,
    ) -> list[MaterialDetail]:
        try:
            if self.repo:
                return await self.repo.list_material_catalog(q, stock_only)
            return self.store.list_material_catalog(q, stock_only)
        except RuntimeError as exc:
            raise _wrap_bitable_error(exc) from exc
        except Exception as exc:
            raise _wrap_data_error("Bitable 物料目录/库存表", exc) from exc

    async def list_transactions(self, material_id: str, limit: int = 20) -> list[Transaction]:
        if self.repo:
            if not await self.repo.get_material(material_id):
                raise AppError(4004, "物料未找到", 404)
            return await self.repo.get_transactions(material_id, limit)
        if not self.store.get_material(material_id):
            raise AppError(4004, "物料未找到", 404)
        return self.store.get_transactions(material_id, limit)

    async def search_transactions(
        self,
        *,
        user: User,
        keyword: str | None = None,
        operator: str | None = None,
        start_at=None,
        end_at=None,
        limit: int = 100,
    ) -> list[Transaction]:
        scope_to_user = user.role.value == "USER"
        effective_operator = None if scope_to_user else operator
        try:
            if self.repo:
                items = await self.repo.list_transactions(
                    operator=effective_operator,
                    keyword=keyword,
                    start_at=start_at,
                    end_at=end_at,
                    limit=limit if not scope_to_user else min(limit * 4, 500),
                )
            else:
                items = self.store.list_transactions(
                    operator=effective_operator,
                    keyword=keyword,
                    start_at=start_at,
                    end_at=end_at,
                    limit=limit if not scope_to_user else min(limit * 4, 500),
                )
            if scope_to_user:
                items = [tx for tx in items if _user_owns_transaction(tx, user.name)]
            return items[:limit]
        except RuntimeError as exc:
            raise _wrap_bitable_error(exc) from exc
        except ValueError as exc:
            raise AppError(5003, f"Bitable 流水表数据格式错误: {exc}", 500) from exc

    async def list_pending_returns(self, *, borrower: str | None = None):
        try:
            if self.repo:
                txs = await self.repo.list_transactions(limit=500)
            else:
                txs = self.store.list_transactions(limit=500)
            return compute_pending_returns(txs, borrower=borrower)
        except RuntimeError as exc:
            raise _wrap_bitable_error(exc) from exc
        except ValueError as exc:
            raise AppError(5003, f"Bitable 流水表数据格式错误: {exc}", 500) from exc

    async def list_inventory(self, material_id: str | None, location_id: str | None) -> list:
        if self.repo:
            return await self.repo.list_inventory(material_id, location_id)
        return self.store.list_inventory(material_id, location_id)

    async def list_low_stock(self) -> list[LowStockItem]:
        catalog = await self.list_material_catalog(stock_only=False)
        items: list[LowStockItem] = []
        for detail in catalog:
            threshold = detail.material.min_stock or 5
            if detail.total_quantity < threshold:
                summary = format_inventory_summary(detail.inventory)
                items.append(
                    LowStockItem(
                        **detail.material.model_dump(),
                        total_quantity=detail.total_quantity,
                        locations_summary=summary or None,
                        threshold=threshold,
                    )
                )
        items.sort(key=lambda item: (item.total_quantity - item.threshold, item.name))
        return items

    async def list_locations(self) -> list:
        try:
            if self.repo:
                return await self.repo.list_locations()
            return list(self.store.locations.values())
        except RuntimeError as exc:
            raise _wrap_bitable_error(exc) from exc
        except Exception as exc:
            raise _wrap_data_error("Bitable 库位表", exc) from exc

    async def create_location(self, payload: LocationCreate) -> Location:
        try:
            if self.repo:
                return await self.repo.create_location(payload)
            return self.store.create_location(payload)
        except ValueError as exc:
            msg = str(exc)
            if msg == "location_code_exists":
                raise AppError(1001, "库位编号已存在", 400) from exc
            if msg == "location_parent_not_found":
                raise AppError(1001, "父库位不存在", 400) from exc
            raise
        except RuntimeError as exc:
            raise _wrap_bitable_error(exc) from exc

    async def update_location(self, location_id: str, payload: LocationUpdate) -> Location:
        try:
            if self.repo:
                return await self.repo.update_location(location_id, payload)
            return self.store.update_location(location_id, payload)
        except ValueError as exc:
            msg = str(exc)
            if msg == "location_not_found":
                raise AppError(4004, "库位未找到", 404) from exc
            if msg == "location_code_exists":
                raise AppError(1001, "库位编号已存在", 400) from exc
            if msg == "location_parent_not_found":
                raise AppError(1001, "父库位不存在", 400) from exc
            if msg == "location_self_parent":
                raise AppError(1001, "不能将自己设为父库位", 400) from exc
            raise
        except RuntimeError as exc:
            raise _wrap_bitable_error(exc) from exc

    async def delete_location(self, location_id: str) -> None:
        try:
            if self.repo:
                await self.repo.delete_location(location_id)
            else:
                self.store.delete_location(location_id)
        except ValueError as exc:
            msg = str(exc)
            if msg == "location_not_found":
                raise AppError(4004, "库位未找到", 404) from exc
            if msg.startswith("location_not_empty:"):
                occupied = msg.split(":", 1)[1]
                raise AppError(4003, f"库位仍有库存，当前合计 {occupied}，请先移空后再删除", 400) from exc
            raise
        except RuntimeError as exc:
            raise _wrap_bitable_error(exc) from exc

    async def inbound(self, payload: InboundCreate, user: User) -> Transaction:
        try:
            if self.repo:
                tx = await self.repo.apply_inbound(
                    payload.material_id,
                    payload.location_id,
                    payload.qty,
                    user.open_id,
                    user.name,
                    payload.note,
                    row=payload.row,
                    column=payload.column,
                )
            else:
                tx = self.store.apply_inbound(
                    payload.material_id,
                    payload.location_id,
                    payload.qty,
                    user.name,
                    payload.note,
                    row=payload.row,
                    column=payload.column,
                )
            spec_value = payload.spec.strip() if payload.spec else None
            if spec_value:
                await self.update_material(payload.material_id, MaterialUpdate(spec=spec_value))
            return tx
        except ValueError as exc:
            msg = str(exc)
            if msg == "material_not_found":
                raise AppError(4004, "物料未找到", 404) from exc
            if msg == "location_not_found":
                raise AppError(1001, "库位未找到", 400) from exc
            if msg == "slot_incomplete":
                raise AppError(1001, "货柜格位需同时填写行号和列号", 400) from exc
            raise
        except RuntimeError as exc:
            raise _wrap_bitable_error(exc) from exc

    async def update_inventory_slot(
        self,
        material_id: str,
        location_id: str,
        payload: InventorySlotUpdate,
    ) -> InventoryItem:
        try:
            if self.repo:
                return await self.repo.update_inventory_slot(
                    material_id,
                    location_id,
                    payload.row,
                    payload.column,
                    from_row=payload.from_row,
                    from_column=payload.from_column,
                )
            return self.store.update_inventory_slot(
                material_id,
                location_id,
                payload.row,
                payload.column,
                from_row=payload.from_row,
                from_column=payload.from_column,
            )
        except ValueError as exc:
            msg = str(exc)
            if msg == "material_not_found":
                raise AppError(4004, "物料未找到", 404) from exc
            if msg == "location_not_found":
                raise AppError(1001, "库位未找到", 400) from exc
            if msg == "inventory_not_found":
                raise AppError(4004, "该库位暂无库存记录", 404) from exc
            if msg == "ambiguous_inventory":
                raise AppError(
                    1001,
                    "该库位存在多条库存格位，请指定原行/列后再保存",
                    400,
                ) from exc
            if msg == "slots_not_enabled":
                raise AppError(
                    1001,
                    "格位编辑未启用，请在 Bitable 库存表添加「行」「列」数字列，并配置 BITABLE_F_INVENTORY_ROW / BITABLE_F_INVENTORY_COLUMN",
                    400,
                ) from exc
            raise
        except RuntimeError as exc:
            raise _wrap_bitable_error(exc) from exc

    async def purchase_inbound(self, payload: PurchaseInboundCreate, user: User) -> Transaction:
        note_parts = ["管理员进货"]
        if payload.supplier:
            note_parts.append(f"供货商：{payload.supplier.strip()}")
        if payload.note:
            note_parts.append(payload.note)
        inbound_payload = InboundCreate(
            material_id=payload.material_id,
            location_id=payload.location_id,
            qty=payload.qty,
            idempotency_key=payload.idempotency_key,
            note="；".join(note_parts),
        )
        try:
            if payload.supplier:
                if self.repo:
                    await self.repo.update_material_supplier(payload.material_id, payload.supplier)
                else:
                    self.store.update_material_supplier(payload.material_id, payload.supplier)
        except ValueError as exc:
            if str(exc) == "material_not_found":
                raise AppError(4004, "物料未找到", 404) from exc
            raise
        except RuntimeError as exc:
            raise AppError(
                5002,
                f"进货失败：写入物料供货商字段失败，请检查 materials 表是否存在“{self.settings.bitable_f_material_supplier}”字段且为文本字段。原始错误：{exc}",
                500,
            ) from exc
        except Exception as exc:
            raise AppError(
                5003,
                f"进货失败：更新供货商时发生 {type(exc).__name__}: {exc}",
                500,
            ) from exc
        try:
            return await self.inbound(inbound_payload, user)
        except AppError as exc:
            raise AppError(exc.code, f"进货失败：{exc.message}", exc.status_code) from exc
        except Exception as exc:
            raise AppError(
                5003,
                f"进货失败：执行入库时发生 {type(exc).__name__}: {exc}",
                500,
            ) from exc

    async def outbound(self, payload: OutboundCreate, user: User) -> Transaction:
        remark = format_outbound_remark(
            payload.note,
            return_required=payload.return_required or False,
            return_due_at=payload.return_due_at,
            row=payload.row,
            column=payload.column,
        )
        try:
            if self.repo:
                return await self.repo.apply_outbound(
                    payload.material_id,
                    payload.location_id,
                    payload.qty,
                    user.open_id,
                    user.name,
                    remark,
                    row=payload.row,
                    column=payload.column,
                )
            return self.store.apply_outbound(
                payload.material_id,
                payload.location_id,
                payload.qty,
                user.name,
                remark,
                row=payload.row,
                column=payload.column,
            )
        except ValueError as exc:
            msg = str(exc)
            if msg == "material_not_found":
                raise AppError(4004, "物料未找到", 404) from exc
            if msg.startswith("insufficient_stock:"):
                available = msg.split(":", 1)[1]
                raise AppError(4002, f"库存不足: 当前可用 {available}", 400) from exc
            raise
        except RuntimeError as exc:
            raise _wrap_bitable_error(exc) from exc

    async def create_request(self, payload: StockRequestCreate, user: User) -> StockRequest:
        try:
            if self.repo:
                request = await self.repo.create_request(payload, user.open_id, user.name)
            else:
                request = self.store.create_request(payload, user.open_id, user.name)

            # 同步创建飞书审批实例（不阻塞主流程）
            if self.settings.feishu_approval_enabled and self.settings.feishu_approval_code:
                await self._try_create_feishu_approval(request.id, request, user)

            return request
        except ValueError as exc:
            msg = str(exc)
            if msg == "material_not_found":
                raise AppError(4004, "物料未找到", 404) from exc
            if msg == "location_not_found":
                raise AppError(1001, "库位未找到", 400) from exc
            if msg == "outbound_requires_location":
                raise AppError(1001, "出库申请必须选择库位", 400) from exc
            if msg == "return_policy_required":
                raise AppError(1001, "请选择是否需要归还", 400) from exc
            if msg == "return_due_required":
                raise AppError(1001, "请选择预计归还时间", 400) from exc
            raise
        except RuntimeError as exc:
            raise _wrap_bitable_error(exc) from exc

    async def list_requests(
        self,
        *,
        user: User,
        status: StockRequestStatus | None,
        keyword: str | None,
        limit: int,
        mine: bool,
    ) -> list[StockRequest]:
        try:
            if self.repo:
                return await self.repo.list_requests(
                    requester_open_id=user.open_id if mine else None,
                    requester_name=user.name if mine else None,
                    status=status,
                    keyword=keyword,
                    limit=limit,
                )
            return self.store.list_requests(
                requester_open_id=user.open_id if mine else None,
                status=status,
                keyword=keyword,
                limit=limit,
            )
        except RuntimeError as exc:
            raise _wrap_bitable_error(exc) from exc
        except ValueError as exc:
            raise AppError(5003, f"Bitable 申请表数据格式错误: {exc}", 500) from exc

    async def approve_request(self, request_id: str, payload: RequestApprove, user: User) -> StockRequest:
        try:
            if self.repo:
                return await self.repo.approve_request(
                    request_id,
                    user.open_id,
                    user.name,
                    location_id=payload.location_id,
                    row=payload.row,
                    column=payload.column,
                )
            return self.store.approve_request(
                request_id,
                user.open_id,
                user.name,
                location_id=payload.location_id,
                row=payload.row,
                column=payload.column,
            )
        except ValueError as exc:
            msg = str(exc)
            if msg == "request_not_found":
                raise AppError(4004, "申请未找到", 404) from exc
            if msg == "request_already_reviewed":
                raise AppError(1001, "申请已审批，不能重复处理", 400) from exc
            if msg == "location_required_for_inbound_approval":
                raise AppError(1001, "入库申请审批时必须指定目标库位", 400) from exc
            if msg == "material_not_found":
                raise AppError(4004, "物料未找到", 404) from exc
            if msg == "location_not_found":
                raise AppError(1001, "库位未找到", 400) from exc
            if msg.startswith("insufficient_stock:"):
                available = msg.split(":", 1)[1]
                raise AppError(4002, f"库存不足: 当前可用 {available}", 400) from exc
            raise
        except RuntimeError as exc:
            raise _wrap_bitable_error(exc) from exc

    async def reject_request(self, request_id: str, payload: RequestReject, user: User) -> StockRequest:
        try:
            if self.repo:
                return await self.repo.reject_request(request_id, user.open_id, user.name, payload.reason)
            return self.store.reject_request(request_id, user.open_id, user.name, payload.reason)
        except ValueError as exc:
            msg = str(exc)
            if msg == "request_not_found":
                raise AppError(4004, "申请未找到", 404) from exc
            if msg == "request_already_reviewed":
                raise AppError(1001, "申请已审批，不能重复处理", 400) from exc
            raise
        except RuntimeError as exc:
            raise _wrap_bitable_error(exc) from exc

    async def transfer(self, payload: TransferCreate, user: User) -> list[Transaction]:
        try:
            if self.repo:
                return await self.repo.apply_transfer(
                    payload.material_id,
                    payload.from_location_id,
                    payload.to_location_id,
                    payload.qty,
                    user.open_id,
                    user.name,
                    payload.note,
                    to_row=payload.to_row,
                    to_column=payload.to_column,
                    from_row=payload.from_row,
                    from_column=payload.from_column,
                )
            return self.store.apply_transfer(
                payload.material_id,
                payload.from_location_id,
                payload.to_location_id,
                payload.qty,
                user.name,
                payload.note,
                to_row=payload.to_row,
                to_column=payload.to_column,
                from_row=payload.from_row,
                from_column=payload.from_column,
            )
        except ValueError as exc:
            msg = str(exc)
            if msg == "material_not_found":
                raise AppError(4004, "物料未找到", 404) from exc
            if msg == "location_not_found":
                raise AppError(1001, "库位未找到", 400) from exc
            if msg == "same_location":
                raise AppError(1001, "源库位和目标库位不能相同", 400) from exc
            if msg == "slot_incomplete":
                raise AppError(1001, "目标格位需同时填写行号和列号", 400) from exc
            if msg.startswith("insufficient_stock:"):
                available = msg.split(":", 1)[1]
                raise AppError(4002, f"源库位库存不足: 当前可用 {available}", 400) from exc
            raise
        except RuntimeError as exc:
            raise _wrap_bitable_error(exc) from exc

    async def bulk_sync(self, dry_run: bool) -> dict:
        if self.repo:
            snap = await self.repo.snapshot()
            return {"dry_run": dry_run, "message": "Bitable 数据快照", "tables": snap}
        snap = self.store.snapshot()
        return {"dry_run": dry_run, "message": "mock 数据快照", "tables": snap}

    async def refresh_cache(self) -> dict:
        if self.repo:
            result = await self.repo.refresh_core_tables()
            failed = result.get("failed") or {}
            message = "Bitable 缓存已刷新"
            if failed:
                message = "Bitable 缓存部分刷新失败，已保留旧缓存"
            return {"message": message, **result}
        snap = self.store.snapshot()
        return {"message": "mock 模式无需刷新缓存", "tables": snap}

    async def admin_overview(self, start_at=None, end_at=None) -> dict:
        snap = await self.bulk_sync(dry_run=True)
        inventory = await self.list_inventory(None, None)
        transactions = await self._admin_transactions(start_at=start_at, end_at=end_at, limit=500)
        requests = await self._admin_requests(limit=500)
        low_stock = await self.list_low_stock()

        inbound_qty = sum(tx.quantity for tx in transactions if tx.quantity > 0)
        outbound_qty = sum(abs(tx.quantity) for tx in transactions if tx.quantity < 0)
        pending_requests = sum(1 for req in requests if req.status == StockRequestStatus.PENDING)
        approved_requests = sum(1 for req in requests if req.status == StockRequestStatus.APPROVED)
        rejected_requests = sum(1 for req in requests if req.status == StockRequestStatus.REJECTED)

        return {
            "period": {
                "start_at": start_at.isoformat() if start_at else None,
                "end_at": end_at.isoformat() if end_at else None,
            },
            "tables": snap.get("tables", {}),
            "totals": {
                "inventory_quantity": sum(item.quantity for item in inventory),
                "inventory_records": len(inventory),
                "transaction_count": len(transactions),
                "inbound_quantity": inbound_qty,
                "outbound_quantity": outbound_qty,
                "pending_requests": pending_requests,
                "approved_requests": approved_requests,
                "rejected_requests": rejected_requests,
                "low_stock_count": len(low_stock),
            },
            "recent_transactions": [tx.model_dump(mode="json") for tx in transactions[:8]],
            "recent_requests": [req.model_dump(mode="json") for req in requests[:8]],
            "low_stock_items": [item.model_dump(mode="json") for item in low_stock[:8]],
        }

    async def admin_audit(self, start_at=None, end_at=None, limit: int = 50) -> dict:
        transactions = await self._admin_transactions(start_at=start_at, end_at=end_at, limit=limit)
        requests = await self._admin_requests(limit=limit)
        operators: dict[str, int] = {}
        for tx in transactions:
            operators[tx.operator] = operators.get(tx.operator, 0) + 1
        return {
            "recent_transactions": [tx.model_dump(mode="json") for tx in transactions],
            "recent_requests": [req.model_dump(mode="json") for req in requests],
            "operator_counts": operators,
            "period": {
                "start_at": start_at.isoformat() if start_at else None,
                "end_at": end_at.isoformat() if end_at else None,
            },
        }

    async def _admin_transactions(self, *, start_at=None, end_at=None, limit: int) -> list[Transaction]:
        if self.repo:
            return await self.repo.list_transactions(start_at=start_at, end_at=end_at, limit=limit)
        return self.store.list_transactions(start_at=start_at, end_at=end_at, limit=limit)

    async def _admin_requests(self, *, limit: int) -> list[StockRequest]:
        try:
            if self.repo:
                return await self.repo.list_requests(limit=limit)
            return self.store.list_requests(limit=limit)
        except RuntimeError:
            return []

    # ── 管理员纠错方法 ──

    async def update_transaction(self, transaction_id: str, payload: TransactionUpdate) -> Transaction:
        try:
            if self.repo:
                return await self.repo.update_transaction(transaction_id, payload)
            return self.store.update_transaction(transaction_id, payload)
        except ValueError as exc:
            msg = str(exc)
            if msg == "transaction_not_found":
                raise AppError(4004, "流水记录未找到", 404) from exc
            raise
        except RuntimeError as exc:
            raise _wrap_bitable_error(exc) from exc

    async def update_request(self, request_id: str, payload: StockRequestUpdate) -> StockRequest:
        try:
            if self.repo:
                return await self.repo.update_request(request_id, payload)
            return self.store.update_request(request_id, payload)
        except ValueError as exc:
            msg = str(exc)
            if msg == "request_not_found":
                raise AppError(4004, "申请记录未找到", 404) from exc
            raise
        except RuntimeError as exc:
            raise _wrap_bitable_error(exc) from exc

    async def update_inventory_record(
        self, material_id: str, location_id: str, payload: InventoryRecordUpdate,
        row: int | None = None, column: int | None = None,
    ) -> InventoryItem:
        try:
            if self.repo:
                return await self.repo.update_inventory_record(material_id, location_id, payload, row, column)
            return self.store.update_inventory_record(material_id, location_id, payload, row, column)
        except ValueError as exc:
            msg = str(exc)
            if msg == "inventory_not_found":
                raise AppError(4004, "库存记录未找到", 404) from exc
            raise
        except RuntimeError as exc:
            raise _wrap_bitable_error(exc) from exc

    # ── 库位类型管理 ──

    async def list_location_types(self) -> list[str]:
        try:
            if self.repo:
                return await self.repo.list_location_types()
            return self.store.list_location_types()
        except RuntimeError as exc:
            raise _wrap_bitable_error(exc) from exc

    async def add_location_type(self, name: str) -> list[str]:
        try:
            if self.repo:
                return await self.repo.add_location_type(name)
            return self.store.add_location_type(name)
        except ValueError as exc:
            msg = str(exc)
            if msg == "location_type_name_empty":
                raise AppError(1001, "类型名称不能为空", 400) from exc
            if msg == "location_type_exists":
                raise AppError(1001, "该库位类型已存在", 400) from exc
            raise

    async def remove_location_type(self, name: str) -> list[str]:
        try:
            if self.repo:
                return await self.repo.remove_location_type(name)
            return self.store.remove_location_type(name)
        except ValueError as exc:
            msg = str(exc)
            if msg == "location_type_not_found":
                raise AppError(4004, "库位类型未找到", 404) from exc
            if msg == "location_type_in_use":
                raise AppError(4003, "该类型仍有库位在使用，不能删除", 400) from exc
            raise
        except RuntimeError as exc:
            raise _wrap_bitable_error(exc) from exc

    async def update_location_type(self, old_name: str, new_name: str) -> list[str]:
        try:
            if self.repo:
                return await self.repo.update_location_type(old_name, new_name)
            return self.store.update_location_type(old_name, new_name)
        except ValueError as exc:
            msg = str(exc)
            if msg == "location_type_not_found":
                raise AppError(4004, "库位类型未找到", 404) from exc
            if msg == "location_type_exists":
                raise AppError(1001, "目标类型名称已存在", 400) from exc
            if msg == "location_type_name_empty":
                raise AppError(1001, "类型名称不能为空", 400) from exc
            raise
        except RuntimeError as exc:
            raise _wrap_bitable_error(exc) from exc

    # ── 飞书审批集成（内部方法） ──

    async def _try_create_feishu_approval(
        self,
        request_id: str,
        request: StockRequest,
        user: User,
    ) -> None:
        """非阻塞地将出入库申请同步为飞书审批实例。

        失败时不抛异常，降级为现有应用内审批流程。
        instance_code 使用 request.id，用于回调匹配。
        """
        try:
            from app.services.feishu_approval import FeishuApprovalClient

            client = FeishuApprovalClient(self.settings)

            form_values = client.build_form_values(
                material_name=request.material_name or request.material_id,
                quantity=request.quantity,
                request_type=request.type.value,
                location_name=request.location_name,
                reason=request.remark or "",
            )

            title = f"[{request.type.value}] {request.material_name or request.material_id} x{request.quantity}"

            instance_id = await client.create_instance(
                approval_code=self.settings.feishu_approval_code,
                open_id=user.open_id,
                form_values=form_values,
                instance_code=request_id,
                title=title,
            )

            # 把飞书审批实例 ID 回写到申请记录的 remark 备注中
            approval_tag = f"飞书审批: {instance_id}"
            try:
                await self._append_approval_instance_id(request_id, instance_id)
            except Exception:
                logger.warning("回写审批实例 ID 失败 request_id=%s", request_id)

            logger.info(
                "已创建飞书审批 request_id=%s instance_id=%s",
                request_id,
                instance_id,
            )

        except Exception as exc:
            logger.warning(
                "创建飞书审批实例失败（降级为应用内审批）request_id=%s: %s",
                request_id,
                exc,
            )

    async def _append_approval_instance_id(
        self, request_id: str, instance_id: str
    ) -> None:
        """把飞书审批 instance_id 回写到申请记录的备注中（方便运维追溯）。"""
        try:
            if self.repo:
                await self.repo.update_request(
                    request_id,
                    StockRequestUpdate(remark=f"飞书审批: {instance_id}"),
                )
        except Exception:
            pass  # 非关键路径，忽略回写失败
