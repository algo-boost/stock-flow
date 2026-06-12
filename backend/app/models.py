from datetime import datetime
from enum import Enum
from typing import Any, Generic, TypeVar

from pydantic import BaseModel, Field

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
    data: T | None = None


class Category(BaseModel):
    id: str
    name: str
    parent_id: str | None = None


class Location(BaseModel):
    id: str
    code: str
    name: str
    type: str = "货柜"


class Material(BaseModel):
    id: str
    code: str
    name: str
    category_id: str
    category_name: str | None = None
    unit: str = "个"
    spec: str | None = None
    barcode: str | None = None
    default_location_id: str | None = None


class InventoryItem(BaseModel):
    material_id: str
    location_id: str
    location_name: str | None = None
    quantity: int
    last_updated: datetime | None = None


class TransactionType(str, Enum):
    INBOUND = "入库"
    OUTBOUND = "出库"


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


class MaterialDetail(BaseModel):
    material: Material
    inventory: list[InventoryItem]
    total_quantity: int


class PaginatedMaterials(BaseModel):
    items: list[Material]
    total: int
    page: int
    size: int


class InboundCreate(BaseModel):
    material_id: str
    location_id: str
    qty: int = Field(gt=0, le=10000)
    idempotency_key: str = Field(min_length=8, max_length=128)
    note: str | None = Field(default=None, max_length=500)


class OutboundCreate(BaseModel):
    material_id: str
    location_id: str
    qty: int = Field(gt=0, le=10000)
    idempotency_key: str = Field(min_length=8, max_length=128)
    note: str = Field(min_length=1, max_length=500)


class TransactionResult(BaseModel):
    transaction_id: str


class MeResponse(BaseModel):
    user: User
    role_meta: dict[str, Any] | None = None


class BulkSyncRequest(BaseModel):
    dry_run: bool = True


class BulkSyncResult(BaseModel):
    dry_run: bool
    message: str
    tables: dict[str, Any] = Field(default_factory=dict)
