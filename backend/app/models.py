from __future__ import annotations

from datetime import date, datetime
from enum import Enum
from typing import Any, Generic, Optional, TypeVar

from pydantic import BaseModel, Field, model_validator

T = TypeVar("T")


class Role(str, Enum):
    ADMIN = "ADMIN"
    KEEPER = "KEEPER"
    USER = "USER"


class User(BaseModel):
    open_id: str
    name: str
    role: Role


class ApiResponse(BaseModel, Generic[T]):
    code: int = 0
    message: str = "ok"
    data: Optional[T] = None


class Category(BaseModel):
    id: str
    name: str
    parent_id: str | None = None
    major_name: str | None = None
    mid_name: str | None = None
    sub_name: str | None = None
    default_location_type: str | None = None
    examples: str | None = None
    material_count: int = 0
    stock_quantity: int = 0


class CategoryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    parent_id: str | None = Field(default=None, max_length=128)
    default_location_type: str | None = Field(default="货柜", max_length=50)
    examples: str | None = Field(default=None, max_length=200)


class CategoryUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    parent_id: str | None = Field(default=None, max_length=128)
    default_location_type: str | None = Field(default=None, max_length=50)
    examples: str | None = Field(default=None, max_length=200)


class Location(BaseModel):
    id: str
    code: str
    name: str
    type: str = "货柜"
    parent_id: str | None = None
    major_name: str | None = None
    mid_name: str | None = None
    sub_name: str | None = None
    grid_rows: int | None = Field(default=None, ge=1, le=99)
    grid_columns: int | None = Field(default=None, ge=1, le=99)


class LocationCreate(BaseModel):
    code: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=100)
    type: str = Field(default="货柜", min_length=1, max_length=50)
    parent_id: str | None = Field(default=None, max_length=128)
    grid_rows: int | None = Field(default=None, ge=1, le=99)
    grid_columns: int | None = Field(default=None, ge=1, le=99)


class LocationUpdate(BaseModel):
    code: str | None = Field(default=None, min_length=1, max_length=64)
    name: str | None = Field(default=None, min_length=1, max_length=100)
    type: str | None = Field(default=None, min_length=1, max_length=50)
    parent_id: str | None = Field(default=None, max_length=128)
    grid_rows: int | None = Field(default=None, ge=1, le=99)
    grid_columns: int | None = Field(default=None, ge=1, le=99)


class Material(BaseModel):
    id: str
    code: str
    name: str
    category_id: str
    category_name: str | None = None
    major_category: str | None = None
    mid_category: str | None = None
    sub_category: str | None = None
    unit: str = "个"
    spec: str | None = None
    barcode: str | None = None
    default_location_id: str | None = None
    supplier: str | None = None
    min_stock: int = 5


class MaterialCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    category_id: str = Field(min_length=1, max_length=128)
    major_category: str | None = Field(default=None, max_length=100)
    mid_category: str | None = Field(default=None, max_length=100)
    sub_category: str | None = Field(default=None, max_length=100)
    code: str | None = Field(default=None, max_length=64)
    unit: str = Field(default="个", min_length=1, max_length=20)
    spec: str | None = Field(default=None, max_length=200)
    barcode: str | None = Field(default=None, max_length=100)
    default_location_id: str | None = Field(default=None, max_length=128)
    supplier: str | None = Field(default=None, max_length=100)
    min_stock: int = Field(default=5, ge=0, le=100000)


class MaterialUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    category_id: str | None = Field(default=None, min_length=1, max_length=128)
    major_category: str | None = Field(default=None, max_length=100)
    mid_category: str | None = Field(default=None, max_length=100)
    sub_category: str | None = Field(default=None, max_length=100)
    code: str | None = Field(default=None, max_length=64)
    unit: str | None = Field(default=None, min_length=1, max_length=20)
    spec: str | None = Field(default=None, max_length=200)
    barcode: str | None = Field(default=None, max_length=100)
    default_location_id: str | None = Field(default=None, max_length=128)
    supplier: str | None = Field(default=None, max_length=100)
    min_stock: int | None = Field(default=None, ge=0, le=100000)


class InventoryItem(BaseModel):
    material_id: str
    location_id: str
    location_name: str | None = None
    row: int | None = Field(default=None, ge=1, le=99)
    column: int | None = Field(default=None, ge=1, le=99)
    quantity: int
    last_updated: datetime | None = None


class TransactionType(str, Enum):
    INBOUND = "入库"
    OUTBOUND = "出库"
    TRANSFER = "移动"


class StockRequestType(str, Enum):
    INBOUND = "入库"
    OUTBOUND = "出库"


class StockRequestStatus(str, Enum):
    PENDING = "待审批"
    APPROVED = "已通过"
    REJECTED = "已拒绝"


class Transaction(BaseModel):
    id: str
    type: TransactionType
    material_id: str
    material_name: str | None = None
    location_id: str
    location_name: str | None = None
    quantity: int
    operator: str
    remark: str | None = None
    created_at: datetime


class PendingReturn(BaseModel):
    source_tx_id: str
    material_id: str
    material_name: str | None = None
    location_id: str
    location_name: str | None = None
    quantity: int
    borrower: str
    borrowed_at: datetime
    return_due_at: date | None = None
    note: str | None = None
    overdue: bool = False


class StockRequest(BaseModel):
    id: str
    type: StockRequestType
    status: StockRequestStatus
    material_id: str
    material_name: str | None = None
    location_id: str | None = None
    location_name: str | None = None
    quantity: int
    requester_open_id: str
    requester_name: str
    approver_open_id: str | None = None
    approver_name: str | None = None
    remark: str | None = None
    reject_reason: str | None = None
    return_required: bool | None = None
    return_due_at: date | None = None
    row: int | None = None
    column: int | None = None
    transaction_id: str | None = None
    created_at: datetime
    reviewed_at: datetime | None = None


class MaterialDetail(BaseModel):
    material: Material
    inventory: list[InventoryItem]
    total_quantity: int


class MaterialSearchItem(Material):
    total_quantity: int = 0
    locations_summary: str | None = None


class LowStockItem(MaterialSearchItem):
    threshold: int = 5


class PaginatedMaterials(BaseModel):
    items: list[MaterialSearchItem]
    total: int
    page: int
    size: int


class InboundCreate(BaseModel):
    material_id: str
    location_id: str
    qty: int = Field(gt=0, le=10000)
    idempotency_key: str = Field(min_length=8, max_length=128)
    note: str | None = Field(default=None, max_length=500)
    spec: str | None = Field(default=None, max_length=200)
    row: int | None = Field(default=None, ge=1, le=99)
    column: int | None = Field(default=None, ge=1, le=99)


class InventorySlotUpdate(BaseModel):
    row: int = Field(ge=1, le=99)
    column: int = Field(ge=1, le=99)
    from_row: int | None = Field(default=None, ge=1, le=99)
    from_column: int | None = Field(default=None, ge=1, le=99)


# ── 管理员纠错模型 ──

class TransactionUpdate(BaseModel):
    """管理员修改流水记录（仅限纠错场景）"""
    quantity: int | None = Field(default=None, gt=-100000, lt=100000)
    material_id: str | None = Field(default=None, max_length=128)
    location_id: str | None = Field(default=None, max_length=128)
    remark: str | None = Field(default=None, max_length=500)


class StockRequestUpdate(BaseModel):
    """管理员修改出入库申请（仅限纠错场景）"""
    quantity: int | None = Field(default=None, gt=0, le=10000)
    material_id: str | None = Field(default=None, max_length=128)
    location_id: str | None = Field(default=None, max_length=128)
    remark: str | None = Field(default=None, max_length=500)


class InventoryRecordUpdate(BaseModel):
    """管理员直接修改库存数量（盘点纠错）"""
    quantity: int = Field(ge=0, le=100000)
    remark: str | None = Field(default=None, max_length=500)


class PurchaseInboundCreate(InboundCreate):
    supplier: str | None = Field(default=None, max_length=100)


class OutboundCreate(BaseModel):
    material_id: str
    location_id: str
    qty: int = Field(gt=0, le=10000)
    idempotency_key: str = Field(min_length=8, max_length=128)
    note: str = Field(min_length=1, max_length=500)
    return_required: bool | None = None
    return_due_at: date | None = None
    row: int | None = Field(default=None, ge=1, le=99)
    column: int | None = Field(default=None, ge=1, le=99)

    @model_validator(mode="after")
    def validate_outbound(self) -> "OutboundCreate":
        if self.return_required is None:
            raise ValueError("return_policy_required")
        if self.return_required and not self.return_due_at:
            raise ValueError("return_due_required")
        if (self.row is None) ^ (self.column is None):
            raise ValueError("slot_incomplete")
        return self


class StockRequestCreate(BaseModel):
    type: StockRequestType
    material_id: str
    location_id: str | None = None
    qty: int = Field(gt=0, le=10000)
    idempotency_key: str = Field(min_length=8, max_length=128)
    note: str = Field(min_length=1, max_length=500)
    return_required: bool | None = None
    return_due_at: date | None = None
    row: int | None = Field(default=None, ge=1, le=99)
    column: int | None = Field(default=None, ge=1, le=99)

    @model_validator(mode="after")
    def validate_request(self) -> "StockRequestCreate":
        if self.type == StockRequestType.OUTBOUND:
            if not self.location_id:
                raise ValueError("outbound_requires_location")
            if self.return_required is None:
                raise ValueError("return_policy_required")
            if self.return_required and not self.return_due_at:
                raise ValueError("return_due_required")
            if (self.row is None) ^ (self.column is None):
                raise ValueError("slot_incomplete")
        return self


class RequestApprove(BaseModel):
    location_id: str | None = None
    row: int | None = Field(default=None, ge=1, le=99)
    column: int | None = Field(default=None, ge=1, le=99)


class RequestReject(BaseModel):
    reason: str = Field(min_length=1, max_length=500)


class TransferCreate(BaseModel):
    material_id: str
    from_location_id: str
    to_location_id: str
    qty: int = Field(gt=0, le=10000)
    idempotency_key: str = Field(min_length=8, max_length=128)
    note: str | None = Field(default=None, max_length=500)
    to_row: int | None = Field(default=None, ge=1, le=99)
    to_column: int | None = Field(default=None, ge=1, le=99)
    from_row: int | None = Field(default=None, ge=1, le=99)
    from_column: int | None = Field(default=None, ge=1, le=99)


class TransactionResult(BaseModel):
    transaction_id: str


class StockRequestResult(BaseModel):
    request_id: str


class TransferResult(BaseModel):
    transaction_ids: list[str]


class MeResponse(BaseModel):
    user: User
    role_meta: dict[str, Any] | None = None


class BulkSyncRequest(BaseModel):
    dry_run: bool = True


class BulkSyncResult(BaseModel):
    dry_run: bool
    message: str
    tables: dict[str, Any] = Field(default_factory=dict)
