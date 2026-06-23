from pydantic import BaseModel, Field
from enum import Enum
from datetime import datetime


class Role(str, Enum):
    ADMIN = "ADMIN"
    KEEPER = "KEEPER"
    USER = "USER"


class User(BaseModel):
    open_id: str
    name: str
    role: Role = Role.USER


# ── 物料 ──

class Material(BaseModel):
    id: str
    name: str
    category_id: str = ""
    category_name: str = ""
    unit: str = "个"
    spec: str | None = None
    code: str | None = None
    supplier: str | None = None
    min_stock: int = 5


class MaterialCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    category_id: str = Field(min_length=1, max_length=128)
    unit: str = Field(default="个", min_length=1, max_length=20)
    spec: str | None = None
    code: str | None = None


class MaterialSearchItem(Material):
    total_quantity: int = 0
    locations_summary: str | None = None


class PaginatedMaterials(BaseModel):
    items: list[MaterialSearchItem]
    total: int
    page: int
    size: int


# ── 分类 ──

class Category(BaseModel):
    id: str
    name: str
    parent_id: str | None = None
    level: int = 1
    material_count: int = 0


# ── 库位 ──

class Location(BaseModel):
    id: str
    code: str = ""
    name: str
    type: str = ""


class LocationCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    code: str = ""
    type: str = ""


# ── 库存 ──

class InventoryItem(BaseModel):
    material_id: str
    location_id: str
    location_name: str | None = None
    quantity: int
    last_updated: datetime | None = None


# ── 流水 ──

class TransactionType(str, Enum):
    INBOUND = "入库"
    OUTBOUND = "出库"
    TRANSFER = "移动"


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


class InboundCreate(BaseModel):
    material_id: str
    location_id: str
    qty: int = Field(gt=0, le=10000)
    idempotency_key: str = Field(min_length=8, max_length=128)
    note: str | None = None


class OutboundCreate(BaseModel):
    material_id: str
    location_id: str
    qty: int = Field(gt=0, le=10000)
    idempotency_key: str = Field(min_length=8, max_length=128)
    note: str | None = None
