from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

from app.models import Role


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    feishu_app_id: str = ""
    feishu_app_secret: str = ""
    feishu_redirect_uri: str = "http://localhost:5173/"

    bitable_app_token: str = ""
    bitable_table_categories: str = ""
    bitable_table_locations: str = ""
    bitable_table_materials: str = ""
    bitable_table_inventory: str = ""
    bitable_table_transactions: str = ""
    bitable_table_requests: str = ""

    feishu_group_admin: str = ""
    feishu_group_keeper: str = ""
    feishu_group_user: str = ""
    # 联调兜底：ou_xxx:ADMIN,ou_yyy:KEEPER（IM 权限未开通时临时指定角色）
    feishu_role_overrides: str = ""

    app_env: Literal["dev", "uat", "prod"] = "dev"
    bitable_mode: Literal["mock", "real"] = "mock"
    mock_auth_enabled: bool = True
    # 本地 Mock 联调 real Bitable 时，可填真实飞书 open_id，用于写入人员字段
    mock_open_id: str = ""

    api_host: str = "0.0.0.0"
    api_port: int = 8000
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    # 自建前端会话有效期。飞书免登 code 仍由飞书控制，这里控制本系统 Bearer token。
    session_ttl_seconds: int = 24 * 3600
    session_sliding_ttl: bool = True
    # 飞书群组角色判断缓存，减少重复登录时的 IM API 调用。
    feishu_role_cache_ttl_seconds: int = 3600
    # Bitable real 模式表级读缓存。写操作会同步更新缓存，低频人工改表场景下 5 分钟 TTL 较稳妥。
    bitable_cache_ttl_seconds: int = 300
    bitable_warmup_on_startup: bool = True

    # Bitable 字段名（与多维表格列名一致，可按模板调整）
    bitable_f_category_name: str = "分类名称"
    bitable_f_category_parent: str = "父分类ID"
    bitable_f_category_major: str = "大类"
    bitable_f_category_mid: str = "中类"
    bitable_f_category_sub: str = "子类"
    bitable_f_category_parent: str = "父分类ID"
    bitable_f_category_default_location_type: str = "默认库位类型"
    bitable_f_category_examples: str = "典型物料"
    bitable_f_location_code: str = "库位编码"
    bitable_f_location_name: str = "库位名称"
    bitable_f_location_type: str = "库位类型"
    bitable_f_location_parent: str = "父库位ID"
    bitable_f_location_major: str = "库位大类"
    bitable_f_location_mid: str = "库位中类"
    bitable_f_location_sub: str = "库位小类"
    bitable_f_material_name: str = "物料名称"
    bitable_f_material_code: str = "物料编码"
    bitable_f_material_major_category: str = "大类"
    bitable_f_material_mid_category: str = "中类"
    bitable_f_material_sub_category: str = "子类"
    bitable_f_material_spec: str = "规格型号"
    bitable_f_material_unit: str = "单位"
    bitable_f_material_barcode: str = "条码"
    bitable_f_material_category: str = "分类ID"
    bitable_f_material_default_location: str = "默认库位ID"
    bitable_f_material_supplier: str = "供货商"
    bitable_f_material_min_stock: str = "安全库存"
    bitable_f_inventory_material: str = "物料ID"
    bitable_f_inventory_location: str = "库位ID"
    bitable_f_inventory_quantity: str = "库存数量"
    bitable_f_inventory_updated: str = "更新时间"
    # 货柜格位（多维表格有对应数字列时填写列名；留空则 real 模式按库位汇总）
    bitable_f_inventory_row: str = ""
    bitable_f_inventory_column: str = ""
    bitable_f_tx_type: str = "交易类型"
    bitable_f_tx_material: str = "物料ID"
    bitable_f_tx_location: str = "库位ID"
    bitable_f_tx_quantity: str = "数量"
    bitable_f_tx_operator: str = "操作人"
    bitable_f_tx_remark: str = "备注"
    bitable_f_tx_created: str = "创建时间"
    bitable_f_request_type: str = "申请类型"
    bitable_f_request_status: str = "审批状态"
    bitable_f_request_material: str = "物料ID"
    bitable_f_request_location: str = "库位ID"
    bitable_f_request_quantity: str = "数量"
    bitable_f_request_requester: str = "申请人"
    bitable_f_request_approver: str = "审批人"
    bitable_f_request_remark: str = "申请说明"
    bitable_f_request_reject_reason: str = "拒绝原因"
    bitable_f_request_transaction: str = "流水ID"
    bitable_f_request_created: str = "申请时间"
    bitable_f_request_reviewed: str = "审批时间"
    # Erniu 模板单选值（非中文）
    bitable_v_tx_inbound: str = "in"
    bitable_v_tx_outbound: str = "out"
    bitable_v_tx_transfer: str = "transfer"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def feishu_configured(self) -> bool:
        return bool(self.feishu_app_id and self.feishu_app_secret)

    @property
    def feishu_role_override_map(self) -> dict[str, Role]:
        result: dict[str, Role] = {}
        for part in self.feishu_role_overrides.split(","):
            part = part.strip()
            if ":" not in part:
                continue
            open_id, role_str = part.split(":", 1)
            open_id = open_id.strip()
            if not open_id:
                continue
            try:
                result[open_id] = Role(role_str.strip().upper())
            except ValueError:
                continue
        return result

    @property
    def inventory_slots_enabled(self) -> bool:
        return bool(self.bitable_f_inventory_row and self.bitable_f_inventory_column)

    @property
    def bitable_configured(self) -> bool:
        return bool(
            self.bitable_app_token
            and self.bitable_table_categories
            and self.bitable_table_locations
            and self.bitable_table_materials
            and self.bitable_table_inventory
            and self.bitable_table_transactions
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()
