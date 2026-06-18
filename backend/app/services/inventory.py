from __future__ import annotations

from app.bitable.repository import BitableRepository
from app.bitable.mock_store import get_mock_store
from app.config import Settings
from app.models import (
    Category,
    CategoryCreate,
    InboundCreate,
    InventoryItem,
    InventorySlotUpdate,
    Location,
    LocationCreate,
    LocationUpdate,
    LowStockItem,
    Material,
    MaterialCreate,
    MaterialDetail,
    OutboundCreate,
    PaginatedMaterials,
    PurchaseInboundCreate,
    RequestReject,
    StockRequest,
    StockRequestCreate,
    StockRequestStatus,
    Transaction,
    TransferCreate,
    User,
)
from app.utils.categories import attach_category_stats
from app.utils.inventory_display import format_inventory_summary
from app.utils.response import AppError


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
    return AppError(5002, msg, 500)


def _wrap_data_error(area: str, exc: Exception) -> AppError:
    return AppError(5003, f"{area}数据格式或字段配置错误: {type(exc).__name__}: {exc}", 500)


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
            for (material_id, _location_id), quantity in inventory_map.items():
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
        effective_operator = operator
        if user.role.value == "USER":
            effective_operator = user.name
        try:
            if self.repo:
                return await self.repo.list_transactions(
                    operator=effective_operator,
                    keyword=keyword,
                    start_at=start_at,
                    end_at=end_at,
                    limit=limit,
                )
            return self.store.list_transactions(
                operator=effective_operator,
                keyword=keyword,
                start_at=start_at,
                end_at=end_at,
                limit=limit,
            )
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
                return await self.repo.apply_inbound(
                    payload.material_id,
                    payload.location_id,
                    payload.qty,
                    user.open_id,
                    user.name,
                    payload.note,
                )
            return self.store.apply_inbound(
                payload.material_id,
                payload.location_id,
                payload.qty,
                user.name,
                payload.note,
                row=payload.row,
                column=payload.column,
            )
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
                raise AppError(1001, "格位编辑当前仅支持 mock 模式，请在 Bitable 库存表补充行列字段后启用", 400)
            return self.store.update_inventory_slot(
                material_id,
                location_id,
                payload.row,
                payload.column,
            )
        except ValueError as exc:
            msg = str(exc)
            if msg == "material_not_found":
                raise AppError(4004, "物料未找到", 404) from exc
            if msg == "location_not_found":
                raise AppError(1001, "库位未找到", 400) from exc
            if msg == "inventory_not_found":
                raise AppError(4004, "该库位暂无库存记录", 404) from exc
            raise

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
        try:
            if self.repo:
                return await self.repo.apply_outbound(
                    payload.material_id,
                    payload.location_id,
                    payload.qty,
                    user.open_id,
                    user.name,
                    payload.note,
                )
            return self.store.apply_outbound(
                payload.material_id,
                payload.location_id,
                payload.qty,
                user.name,
                payload.note,
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
                return await self.repo.create_request(payload, user.open_id, user.name)
            return self.store.create_request(payload, user.open_id, user.name)
        except ValueError as exc:
            msg = str(exc)
            if msg == "material_not_found":
                raise AppError(4004, "物料未找到", 404) from exc
            if msg == "location_not_found":
                raise AppError(1001, "库位未找到", 400) from exc
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

    async def approve_request(self, request_id: str, user: User) -> StockRequest:
        try:
            if self.repo:
                return await self.repo.approve_request(request_id, user.open_id, user.name)
            return self.store.approve_request(request_id, user.open_id, user.name)
        except ValueError as exc:
            msg = str(exc)
            if msg == "request_not_found":
                raise AppError(4004, "申请未找到", 404) from exc
            if msg == "request_already_reviewed":
                raise AppError(1001, "申请已审批，不能重复处理", 400) from exc
            if msg == "material_not_found":
                raise AppError(4004, "物料未找到", 404) from exc
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
