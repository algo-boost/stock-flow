from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import time
from typing import Any

from app.bitable.client import BYTableClient
from app.bitable.fields import (
    field_link_id,
    field_number,
    field_text,
    field_user_id,
    field_user_name,
    normalize_tx_type,
    write_link,
    append_operator_label,
    resolve_person_name,
    is_feishu_user_id,
    write_user,
)
from app.config import Settings
from app.models import (
    Category,
    CategoryCreate,
    CategoryUpdate,
    InventoryItem,
    InventoryRecordUpdate,
    Location,
    LocationCreate,
    LocationUpdate,
    Material,
    MaterialCreate,
    MaterialDetail,
    MaterialSearchItem,
    MaterialUpdate,
    StockRequest,
    StockRequestCreate,
    StockRequestStatus,
    StockRequestType,
    StockRequestUpdate,
    Transaction,
    TransactionType,
    TransactionUpdate,
)
from app.utils.categories import category_descendant_ids, derive_category_levels, derive_location_levels
from app.utils.inventory_display import format_inventory_slot, format_inventory_summary
from app.utils.inventory_keys import (
    InventoryKey,
    inv_key,
    key_location_id,
    key_material_id,
    key_column,
    key_row,
    resolve_outbound_slot,
)
from app.utils.request_remark import format_request_remark, parse_request_remark

_TABLE_CACHE: dict[tuple[str, str], tuple[float, list[dict[str, Any]]]] = {}
_TABLE_INFLIGHT: dict[tuple[str, str], asyncio.Task[list[dict[str, Any]]]] = {}


class BitableRepository:
    """Bitable real 模式：读写五表（字段名可通过 Settings 配置）。"""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.client = BYTableClient(settings)
        self._materials_cache: dict[str, Material] | None = None
        self._locations_cache: dict[str, Location] | None = None

    async def close(self) -> None:
        await self.client.close()

    def _slots_enabled(self) -> bool:
        return self.settings.inventory_slots_enabled

    def _inv_key(
        self,
        material_id: str,
        location_id: str,
        row: int | None = None,
        column: int | None = None,
    ) -> InventoryKey:
        return inv_key(
            material_id,
            location_id,
            row,
            column,
            slots_enabled=self._slots_enabled(),
        )

    def _read_inventory_slot(self, fields: dict[str, Any]) -> tuple[int | None, int | None]:
        s = self.settings
        if not self._slots_enabled():
            return None, None
        row_val = field_number(fields.get(s.bitable_f_inventory_row))
        col_val = field_number(fields.get(s.bitable_f_inventory_column))
        row = row_val if row_val > 0 else None
        col = col_val if col_val > 0 else None
        if row is not None and col is not None:
            return row, col
        return None, None

    def _slot_from_key_or_fields(
        self, key: InventoryKey, fields: dict[str, Any]
    ) -> tuple[int | None, int | None]:
        row, column = self._read_inventory_slot(fields)
        if row is not None and column is not None:
            return row, column
        return key_row(key), key_column(key)

    def _resolve_inventory_record(
        self,
        inv_records: dict[InventoryKey, dict[str, Any]],
        material_id: str,
        location_id: str,
        from_row: int | None,
        from_column: int | None,
    ) -> tuple[InventoryKey, dict[str, Any]]:
        old_key = self._inv_key(material_id, location_id, from_row, from_column)
        if old_key in inv_records:
            rec = inv_records[old_key]
            qty = field_number(rec.get("fields", {}).get(self.settings.bitable_f_inventory_quantity))
            if qty > 0:
                return old_key, rec

        matches: list[tuple[InventoryKey, dict[str, Any]]] = []
        for key, rec in inv_records.items():
            if key_material_id(key) != material_id or key_location_id(key) != location_id:
                continue
            qty = field_number(rec.get("fields", {}).get(self.settings.bitable_f_inventory_quantity))
            if qty <= 0:
                continue
            row, column = self._slot_from_key_or_fields(key, rec.get("fields", {}))
            if from_row is not None and from_column is not None:
                if row == from_row and column == from_column:
                    matches.append((key, rec))
            elif from_row is None and from_column is None:
                matches.append((key, rec))

        if len(matches) == 1:
            return matches[0]
        if len(matches) > 1:
            raise ValueError("ambiguous_inventory")
        raise ValueError("inventory_not_found")

    def _inventory_item_from_record(
        self,
        key: InventoryKey,
        rec: dict[str, Any],
        locations: dict[str, Location],
    ) -> InventoryItem:
        fields = rec.get("fields", {})
        qty = field_number(fields.get(self.settings.bitable_f_inventory_quantity))
        updated = fields.get(self.settings.bitable_f_inventory_updated)
        last_updated = None
        if isinstance(updated, (int, float)):
            last_updated = datetime.fromtimestamp(updated / 1000, tz=timezone.utc)
        lid = key_location_id(key)
        loc = locations.get(lid)
        if self._slots_enabled():
            field_row, field_col = self._read_inventory_slot(fields)
            if field_row is not None and field_col is not None:
                row, column = field_row, field_col
            else:
                row, column = key_row(key), key_column(key)
        else:
            row, column = None, None
        return InventoryItem(
            material_id=key_material_id(key),
            location_id=lid,
            location_name=loc.name if loc else lid,
            quantity=qty,
            row=row,
            column=column,
            last_updated=last_updated,
        )

    async def _list_all(self, table_id: str) -> list[dict[str, Any]]:
        if not table_id:
            return []
        ttl = max(self.settings.bitable_cache_ttl_seconds, 0)

        # 1. 内存缓存（最快）
        cache_key = (self.settings.bitable_app_token, table_id)
        now = time.monotonic()
        if ttl > 0 and cache_key in _TABLE_CACHE:
            cached_at, records = _TABLE_CACHE[cache_key]
            if now - cached_at <= ttl:
                return records

        # 2. SQLite 本地缓存（毫秒级，跨重启持久化）
        if self.settings.sqlite_cache_enabled and self.settings.bitable_mode == "real":
            from app.bitable.sqlite_cache import get_sqlite_cache
            sqlite = get_sqlite_cache()
            sqlite_age = sqlite.get_cache_age(table_id)
            sqlite_stale = sqlite_age is None or (ttl > 0 and now - sqlite_age > ttl)
            if sqlite_age is not None and (ttl == 0 or not sqlite_stale):
                records = sqlite.get_records(table_id)
                if records:
                    _TABLE_CACHE[cache_key] = (now, records)
                    return records

        # 3. Bitable API（慢，仅在缓存过期时）
        inflight = _TABLE_INFLIGHT.get(cache_key)
        if inflight:
            records = await inflight
        else:
            task = asyncio.create_task(self.client.list_records(table_id))
            _TABLE_INFLIGHT[cache_key] = task
            try:
                records = await task
            finally:
                _TABLE_INFLIGHT.pop(cache_key, None)

        if ttl > 0 and records:
            _TABLE_CACHE[cache_key] = (time.monotonic(), records)

        # 同步写入 SQLite 缓存
        if self.settings.sqlite_cache_enabled and records and self.settings.bitable_mode == "real":
            from app.bitable.sqlite_cache import get_sqlite_cache
            try:
                get_sqlite_cache().upsert_records(table_id, records)
            except Exception:
                pass

        return records

    def _invalidate_table_cache(self, *table_ids: str) -> None:
        app_token = self.settings.bitable_app_token
        for table_id in table_ids:
            if table_id:
                _TABLE_CACHE.pop((app_token, table_id), None)
                _TABLE_INFLIGHT.pop((app_token, table_id), None)

    def _upsert_cached_record(self, table_id: str, record: dict[str, Any]) -> None:
        """写操作成功后同步更新表级缓存 + SQLite。"""
        if not table_id or not record.get("record_id"):
            return
        # 同步到 SQLite
        self._sync_sqlite_upsert(table_id, record)
        # 更新内存缓存
        cache_key = (self.settings.bitable_app_token, table_id)
        cached = _TABLE_CACHE.get(cache_key)
        if not cached:
            return

        cached_at, records = cached
        next_records: list[dict[str, Any]] = []
        replaced = False
        for item in records:
            if item.get("record_id") == record["record_id"]:
                merged = {
                    **item,
                    **record,
                    "created_time": record.get("created_time") or item.get("created_time"),
                    "last_modified_time": record.get("last_modified_time") or item.get("last_modified_time"),
                    "fields": {
                        **item.get("fields", {}),
                        **record.get("fields", {}),
                    },
                }
                next_records.append(merged)
                replaced = True
            else:
                next_records.append(item)
        if not replaced:
            if not record.get("created_time"):
                now_ms = int(time.time() * 1000)
                record = {
                    **record,
                    "created_time": now_ms,
                    "last_modified_time": record.get("last_modified_time") or now_ms,
                }
            next_records.append(record)
        _TABLE_CACHE[cache_key] = (cached_at, next_records)

    def _remove_cached_record(self, table_id: str, record_id: str) -> None:
        if not table_id or not record_id:
            return
        # 同步删除 SQLite
        self._sync_sqlite_delete(table_id, record_id)
        cache_key = (self.settings.bitable_app_token, table_id)
        cached = _TABLE_CACHE.get(cache_key)
        if not cached:
            return
        cached_at, records = cached
        _TABLE_CACHE[cache_key] = (
            cached_at,
            [item for item in records if item.get("record_id") != record_id],
        )

    def _cached_record(self, record_id: str, fields: dict[str, Any]) -> dict[str, Any]:
        now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
        return {
            "record_id": record_id,
            "fields": fields,
            "created_time": now_ms,
            "last_modified_time": now_ms,
        }

    async def warmup_core_tables(self) -> dict[str, str | None]:
        """预热五表缓存，降低服务重启后的首次页面等待时间。"""
        return await self._refresh_tables_best_effort(self._core_table_ids(), force=False, retries=1)

    async def refresh_core_tables(self) -> dict[str, Any]:
        """手动刷新五表缓存，用于 Bitable 直接改表后的同步。"""
        table_ids = self._core_table_ids()
        results = await self._refresh_tables_best_effort(table_ids, force=True)
        failures = {tid: msg for tid, msg in results.items() if msg}
        return {
            "tables": await self.snapshot(),
            "refreshed": [tid for tid, msg in results.items() if not msg],
            "failed": failures,
        }

    async def _refresh_tables_best_effort(
        self,
        table_ids: list[str],
        *,
        force: bool,
        retries: int = 3,
    ) -> dict[str, str | None]:
        async def refresh_one(table_id: str) -> tuple[str, str | None]:
            try:
                await self._refresh_table_cache(table_id, force=force, retries=retries)
                return table_id, None
            except Exception as exc:
                # 刷新失败时保留旧缓存，避免把后续读操作打回全表冷加载。
                return table_id, str(exc)

        unique_ids = [table_id for table_id in table_ids if table_id]
        if not unique_ids:
            return {}
        pairs = await asyncio.gather(*(refresh_one(table_id) for table_id in unique_ids))
        return dict(pairs)

    async def _refresh_table_cache(
        self,
        table_id: str,
        *,
        force: bool,
        retries: int = 3,
    ) -> list[dict[str, Any]]:
        if not table_id:
            return []
        cache_key = (self.settings.bitable_app_token, table_id)
        if not force and cache_key in _TABLE_CACHE:
            return _TABLE_CACHE[cache_key][1]
        records = await self.client.list_records(table_id, retries=retries)
        if self.settings.bitable_cache_ttl_seconds > 0:
            _TABLE_CACHE[cache_key] = (time.monotonic(), records)
        return records

    def _core_table_ids(self) -> list[str]:
        s = self.settings
        return [
            s.bitable_table_categories,
            s.bitable_table_locations,
            s.bitable_table_materials,
            s.bitable_table_inventory,
            s.bitable_table_transactions,
            s.bitable_table_requests,
        ]

    async def _load_materials(self) -> dict[str, Material]:
        if self._materials_cache is not None:
            return self._materials_cache
        s = self.settings
        records, locations, categories = await asyncio.gather(
            self._list_all(s.bitable_table_materials),
            self._load_locations(),
            self._load_categories(),
        )
        result: dict[str, Material] = {}
        for rec in records:
            fields = rec.get("fields", {})
            rid = rec["record_id"]
            cat_id = field_link_id(fields.get(s.bitable_f_material_category)) or ""
            category = categories.get(cat_id)
            major_category = field_text(fields.get(s.bitable_f_material_major_category))
            mid_category = field_text(fields.get(s.bitable_f_material_mid_category))
            sub_category = field_text(fields.get(s.bitable_f_material_sub_category))
            loc_id = field_link_id(fields.get(s.bitable_f_material_default_location)) or ""
            min_stock_value = field_number(fields.get(s.bitable_f_material_min_stock))
            result[rid] = Material(
                id=rid,
                code=field_text(fields.get(s.bitable_f_material_code)) or rid,
                name=field_text(fields.get(s.bitable_f_material_name)) or "未命名物料",
                category_id=cat_id,
                category_name=category.name if category else None,
                major_category=major_category or (category.major_name if category else None),
                mid_category=mid_category or (category.mid_name if category else None),
                sub_category=sub_category or (category.sub_name if category else None),
                unit=field_text(fields.get(s.bitable_f_material_unit)) or "个",
                spec=field_text(fields.get(s.bitable_f_material_spec)),
                barcode=field_text(fields.get(s.bitable_f_material_barcode)),
                default_location_id=loc_id or None,
                supplier=field_text(fields.get(s.bitable_f_material_supplier)),
                min_stock=min_stock_value if min_stock_value > 0 else 5,
            )
            if loc_id and loc_id in locations and not result[rid].default_location_id:
                pass
        self._materials_cache = result
        return result

    async def _load_categories(self) -> dict[str, Category]:
        s = self.settings
        if not s.bitable_table_categories:
            return {}
        records = await self._list_all(s.bitable_table_categories)
        result: dict[str, Category] = {}
        for rec in records:
            fields = rec.get("fields", {})
            rid = rec["record_id"]
            parent_id = field_link_id(fields.get(s.bitable_f_category_parent))
            major = field_text(fields.get(s.bitable_f_category_major))
            mid = field_text(fields.get(s.bitable_f_category_mid))
            sub = field_text(fields.get(s.bitable_f_category_sub))
            legacy_name = field_text(fields.get(s.bitable_f_category_name))
            name = sub or mid or legacy_name or major or rid
            result[rid] = Category(
                id=rid,
                name=name,
                parent_id=parent_id,
                major_name=major,
                mid_name=mid,
                sub_name=sub,
                default_location_type=field_text(fields.get(s.bitable_f_category_default_location_type)),
                examples=field_text(fields.get(s.bitable_f_category_examples)),
            )
        for category_id, category in list(result.items()):
            if category.major_name and category.mid_name is not None and category.sub_name is not None:
                continue
            if category.major_name and category.mid_name is not None:
                continue
            major_name, mid_name, sub_name = derive_category_levels(result, category.parent_id, category.name)
            result[category_id] = category.model_copy(
                update={
                    "major_name": category.major_name or major_name or category.name,
                    "mid_name": category.mid_name if category.mid_name is not None else mid_name,
                    "sub_name": category.sub_name if category.sub_name is not None else sub_name,
                }
            )
        return result

    async def list_categories(self) -> list[Category]:
        categories = await self._load_categories()
        return list(categories.values())

    async def create_category(self, payload: CategoryCreate) -> Category:
        categories = await self._load_categories()
        name = payload.name.strip()
        parent_id = payload.parent_id
        if parent_id and parent_id not in categories:
            raise ValueError("parent_not_found")
        if any(category.name == name and category.parent_id == parent_id for category in categories.values()):
            raise ValueError("category_name_exists")

        major_name, mid_name, sub_name = derive_category_levels(categories, parent_id, name)
        s = self.settings
        fields: dict[str, Any] = {
            s.bitable_f_category_name: name,
            s.bitable_f_category_major: major_name or name,
            s.bitable_f_category_default_location_type: payload.default_location_type or "货柜",
        }
        if parent_id:
            fields[s.bitable_f_category_parent] = write_link(parent_id)
        if mid_name:
            fields[s.bitable_f_category_mid] = mid_name
        if sub_name:
            fields[s.bitable_f_category_sub] = sub_name
        if payload.examples:
            fields[s.bitable_f_category_examples] = payload.examples.strip()

        rec = await self.client.create_record(s.bitable_table_categories, fields)
        rid = rec.get("record_id", "")
        category = Category(
            id=rid,
            name=name,
            parent_id=parent_id,
            major_name=major_name or name,
            mid_name=mid_name,
            sub_name=sub_name,
            default_location_type=payload.default_location_type or "货柜",
            examples=payload.examples.strip() if payload.examples else None,
        )
        self._upsert_cached_record(
            s.bitable_table_categories,
            rec if rec.get("fields") else self._cached_record(rid, fields),
        )

        # 如果在中类下新增子类，自动把中类下的物料迁移到新子类
        if parent_id and sub_name:
            try:
                materials = await self._load_materials()
                migrated = 0
                for mat_id, mat in list(materials.items()):
                    if mat.category_id == parent_id:
                        update_fields: dict[str, Any] = {
                            s.bitable_f_material_category: write_link(rid),
                            s.bitable_f_material_sub_category: sub_name,
                        }
                        await self.client.update_record(s.bitable_table_materials, mat_id, update_fields)
                        migrated += 1
                if migrated:
                    logger.info("新增子类 %s → 迁移了 %d 个物料到 Bitable", name, migrated)
            except Exception as exc:
                logger.warning("子类物料迁移失败（非致命）: %s", exc)

        return category

    async def delete_category(self, category_id: str) -> None:
        categories = await self._load_categories()
        category = categories.get(category_id)
        if not category:
            raise ValueError("category_not_found")

        descendant_ids = category_descendant_ids(categories, category_id)
        materials = await self._load_materials()
        linked_materials = [
            material for material in materials.values() if material.category_id in descendant_ids
        ]
        if category.parent_id is None and linked_materials:
            names = ",".join(material.name for material in linked_materials)
            raise ValueError(f"category_in_use:{names}")

        parent = categories.get(category.parent_id) if category.parent_id else None
        s = self.settings
        if parent:
            parent_major = parent.major_name or parent.name
            parent_mid = parent.mid_name or ""
            parent_sub = parent.sub_name or parent.name
            for material in linked_materials:
                fields: dict[str, Any] = {
                    s.bitable_f_material_category: write_link(parent.id),
                    s.bitable_f_material_major_category: parent_major,
                    s.bitable_f_material_sub_category: parent_sub,
                }
                if parent_mid:
                    fields[s.bitable_f_material_mid_category] = parent_mid
                rec = await self.client.update_record(s.bitable_table_materials, material.id, fields)
                self._upsert_cached_record(
                    s.bitable_table_materials,
                    rec if rec.get("fields") else self._cached_record(material.id, fields),
                )

        def depth(item_id: str) -> int:
            level = 0
            current = categories.get(item_id)
            while current and current.parent_id:
                level += 1
                current = categories.get(current.parent_id)
            return level

        for item_id in sorted(descendant_ids, key=depth, reverse=True):
            await self.client.delete_record(s.bitable_table_categories, item_id)
            self._remove_cached_record(s.bitable_table_categories, item_id)
        self._materials_cache = None

    async def update_category(self, category_id: str, payload: CategoryUpdate) -> Category:
        categories = await self._load_categories()
        current = categories.get(category_id)
        if not current:
            raise ValueError("category_not_found")

        updates = payload.model_dump(exclude_unset=True)
        if not updates:
            return current

        s = self.settings
        name = updates.get("name", current.name)
        if isinstance(name, str):
            name = name.strip()

        parent_id = updates.get("parent_id", current.parent_id)
        if parent_id and parent_id == category_id:
            raise ValueError("category_self_parent")
        if parent_id and parent_id not in categories:
            raise ValueError("parent_not_found")

        if "name" in updates:
            if any(
                cat.id != category_id and cat.name == name and cat.parent_id == parent_id
                for cat in categories.values()
            ):
                raise ValueError("category_name_exists")

        major_name, mid_name, sub_name = derive_category_levels(categories, parent_id, name)
        fields: dict[str, Any] = {}
        if "name" in updates:
            fields[s.bitable_f_category_name] = name
            fields[s.bitable_f_category_major] = major_name or name
            if mid_name:
                fields[s.bitable_f_category_mid] = mid_name
            if sub_name:
                fields[s.bitable_f_category_sub] = sub_name
        if "parent_id" in updates:
            if parent_id:
                fields[s.bitable_f_category_parent] = write_link(parent_id)
            else:
                fields[s.bitable_f_category_parent] = ""  # 清空父分类
            fields[s.bitable_f_category_major] = major_name or name
            fields[s.bitable_f_category_mid] = mid_name or ""
            if sub_name:
                fields[s.bitable_f_category_sub] = sub_name
        if "default_location_type" in updates:
            fields[s.bitable_f_category_default_location_type] = (
                updates["default_location_type"] or ""
            )
        if "examples" in updates:
            fields[s.bitable_f_category_examples] = (
                updates["examples"].strip() if updates["examples"] else ""
            )

        if fields:
            rec = await self.client.update_record(s.bitable_table_categories, category_id, fields)
            self._upsert_cached_record(
                s.bitable_table_categories,
                rec if rec.get("fields") else self._cached_record(category_id, fields),
            )

        updated = Category(
            id=category_id,
            name=name,
            parent_id=parent_id,
            major_name=major_name or name,
            mid_name=mid_name,
            sub_name=sub_name,
            default_location_type=updates.get(
                "default_location_type", current.default_location_type
            ),
            examples=updates.get("examples", current.examples),
        )

        # 如果分类名称或层级发生变更，同步更新关联物料的分类信息
        if any(k in updates for k in ("name", "parent_id")):
            materials = await self._load_materials()
            linked = [
                m for m in materials.values() if m.category_id == category_id
            ]
            for material in linked:
                mat_fields: dict[str, Any] = {
                    s.bitable_f_material_category: write_link(category_id),
                    s.bitable_f_material_major_category: updated.major_name or updated.name,
                    s.bitable_f_material_sub_category: updated.sub_name or updated.name,
                }
                if updated.mid_name:
                    mat_fields[s.bitable_f_material_mid_category] = updated.mid_name
                try:
                    rec = await self.client.update_record(
                        s.bitable_table_materials, material.id, mat_fields
                    )
                    self._upsert_cached_record(
                        s.bitable_table_materials,
                        rec if rec.get("fields") else self._cached_record(material.id, mat_fields),
                    )
                except Exception:
                    pass  # 物料更新失败不影响分类本身更新
            self._materials_cache = None

        # 使分类缓存失效
        self._invalidate_table_cache(s.bitable_table_categories)
        return updated

    async def _load_locations(self) -> dict[str, Location]:
        if self._locations_cache is not None:
            return self._locations_cache
        s = self.settings
        records = await self._list_all(s.bitable_table_locations)
        result: dict[str, Location] = {}
        for rec in records:
            fields = rec.get("fields", {})
            rid = rec["record_id"]
            parent_id = field_link_id(fields.get(s.bitable_f_location_parent))
            major = field_text(fields.get(s.bitable_f_location_major))
            mid = field_text(fields.get(s.bitable_f_location_mid))
            sub = field_text(fields.get(s.bitable_f_location_sub))
            result[rid] = Location(
                id=rid,
                code=field_text(fields.get(s.bitable_f_location_code)) or rid,
                name=field_text(fields.get(s.bitable_f_location_name)) or rid,
                type=field_text(fields.get(s.bitable_f_location_type)) or "货柜",
                parent_id=parent_id,
                major_name=major,
                mid_name=mid,
                sub_name=sub,
            )
        # 自动派生缺失的层级字段
        for loc_id, loc in list(result.items()):
            if loc.major_name and loc.mid_name is not None and loc.sub_name is not None:
                continue
            if loc.major_name and loc.mid_name is not None:
                continue
            major_name, mid_name, sub_name = derive_location_levels(result, loc.parent_id, loc.name)
            result[loc_id] = loc.model_copy(
                update={
                    "major_name": loc.major_name or major_name or loc.name,
                    "mid_name": loc.mid_name if loc.mid_name is not None else mid_name,
                    "sub_name": loc.sub_name if loc.sub_name is not None else sub_name,
                }
            )
        self._locations_cache = result
        return result

    async def search_materials(
        self,
        q: str | None,
        search_by: str,
        category: str | None,
        location: str | None,
        stock_only: bool,
        page: int,
        size: int,
    ) -> tuple[list[MaterialSearchItem], int]:
        materials_map, inv_records, locations = await asyncio.gather(
            self._load_materials(),
            self._load_inventory_records(),
            self._load_locations(),
        )
        materials = list(materials_map.values())
        inventory = self._inventory_map_from_records(inv_records)

        if q:
            keyword = q.lower()
            def match(material: Material) -> bool:
                if search_by == "name":
                    return keyword in material.name.lower()
                if search_by == "code":
                    return keyword in material.code.lower() or (
                        material.barcode is not None and keyword in material.barcode.lower()
                    )
                if search_by == "category":
                    return (
                        (material.category_name is not None and keyword in material.category_name.lower())
                        or (material.major_category is not None and keyword in material.major_category.lower())
                        or (material.mid_category is not None and keyword in material.mid_category.lower())
                        or (material.sub_category is not None and keyword in material.sub_category.lower())
                    )
                return (
                    keyword in material.name.lower()
                    or keyword in material.code.lower()
                    or (material.spec is not None and keyword in material.spec.lower())
                    or (material.supplier is not None and keyword in material.supplier.lower())
                    or (material.barcode is not None and keyword in material.barcode.lower())
                    or (material.category_name is not None and keyword in material.category_name.lower())
                    or (material.major_category is not None and keyword in material.major_category.lower())
                    or (material.mid_category is not None and keyword in material.mid_category.lower())
                    or (material.sub_category is not None and keyword in material.sub_category.lower())
                )

            materials = [m for m in materials if match(m)]
        if category:
            categories = await self._load_categories()
            if category in categories:
                allowed_ids = category_descendant_ids(categories, category)
                materials = [m for m in materials if m.category_id in allowed_ids]
            else:
                materials = [
                    m
                    for m in materials
                    if m.category_id == category
                    or m.category_name == category
                    or m.major_category == category
                    or m.mid_category == category
                    or m.sub_category == category
                ]
        if location:
            mat_ids = {
                key_material_id(key)
                for key, qty in inventory.items()
                if key_location_id(key) == location and qty > 0
            }
            materials = [m for m in materials if m.id in mat_ids]
        if stock_only:
            mat_ids = {key_material_id(key) for key, qty in inventory.items() if qty > 0}
            materials = [m for m in materials if m.id in mat_ids]

        total = len(materials)
        start = (page - 1) * size
        return [
            self._to_search_item(m, inventory, inv_records, locations)
            for m in materials[start : start + size]
        ], total

    def _to_search_item(
        self,
        material: Material,
        inventory: dict[InventoryKey, int],
        inv_records: dict[InventoryKey, dict[str, Any]],
        locations: dict[str, Location],
    ) -> MaterialSearchItem:
        inv_items: list[InventoryItem] = []
        for key, qty in inventory.items():
            if key_material_id(key) != material.id or qty <= 0:
                continue
            rec = inv_records.get(key, {})
            inv_items.append(self._inventory_item_from_record(key, rec, locations))
        inv_items.sort(key=lambda item: (item.location_name or "", item.row or 0, item.column or 0))
        total = sum(item.quantity for item in inv_items)
        summary = "\n".join(format_inventory_slot(item) for item in inv_items[:5]) or None
        return MaterialSearchItem(
            **material.model_dump(),
            total_quantity=total,
            locations_summary=summary or None,
        )

    async def get_material(self, material_id: str) -> Material | None:
        return (await self._load_materials()).get(material_id)

    async def create_material(self, payload: MaterialCreate) -> Material:
        categories = await self._load_categories()
        category = categories.get(payload.category_id)
        if not category:
            raise ValueError("category_not_found")
        locations = await self._load_locations()
        if payload.default_location_id and payload.default_location_id not in locations:
            raise ValueError("location_not_found")

        s = self.settings
        code = payload.code or f"MAT-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}"
        fields: dict[str, Any] = {
            s.bitable_f_material_code: code,
            s.bitable_f_material_name: payload.name.strip(),
            s.bitable_f_material_category: write_link(payload.category_id),
            s.bitable_f_material_major_category: (
                payload.major_category or category.major_name or category.name
            ),
            s.bitable_f_material_mid_category: (
                payload.mid_category or category.mid_name or ""
            ),
            s.bitable_f_material_sub_category: (
                payload.sub_category or category.sub_name or category.name
            ),
            s.bitable_f_material_unit: payload.unit.strip() or "个",
            s.bitable_f_material_min_stock: payload.min_stock,
        }
        if payload.spec:
            fields[s.bitable_f_material_spec] = payload.spec.strip()
        if payload.barcode:
            fields[s.bitable_f_material_barcode] = payload.barcode.strip()
        if payload.default_location_id:
            fields[s.bitable_f_material_default_location] = write_link(payload.default_location_id)
        if payload.supplier:
            fields[s.bitable_f_material_supplier] = payload.supplier.strip()

        rec = await self.client.create_record(s.bitable_table_materials, fields)
        rid = rec.get("record_id", "")
        self._materials_cache = None
        self._upsert_cached_record(
            s.bitable_table_materials,
            rec if rec.get("fields") else self._cached_record(rid, fields),
        )
        return Material(
            id=rid,
            code=code,
            name=payload.name.strip(),
            category_id=payload.category_id,
            category_name=category.name,
            major_category=payload.major_category or category.major_name or category.name,
            sub_category=payload.sub_category or category.sub_name or category.name,
            unit=payload.unit.strip() or "个",
            spec=payload.spec.strip() if payload.spec else None,
            barcode=payload.barcode.strip() if payload.barcode else None,
            default_location_id=payload.default_location_id,
            supplier=payload.supplier.strip() if payload.supplier else None,
            min_stock=payload.min_stock,
        )

    async def update_material_supplier(self, material_id: str, supplier: str | None) -> Material:
        material = await self.get_material(material_id)
        if not material:
            raise ValueError("material_not_found")
        supplier_value = supplier.strip() if supplier else None
        s = self.settings
        fields = {s.bitable_f_material_supplier: supplier_value or ""}
        rec = await self.client.update_record(s.bitable_table_materials, material_id, fields)
        self._materials_cache = None
        self._upsert_cached_record(
            s.bitable_table_materials,
            rec if rec.get("fields") else self._cached_record(material_id, fields),
        )
        return material.model_copy(update={"supplier": supplier_value})

    async def update_material(self, material_id: str, payload: MaterialUpdate) -> Material:
        material = await self.get_material(material_id)
        if not material:
            raise ValueError("material_not_found")
        updates = payload.model_dump(exclude_unset=True)
        if not updates:
            return material

        categories = await self._load_categories()
        locations = await self._load_locations()
        category_id = updates.get("category_id", material.category_id)
        category = categories.get(category_id)
        if "category_id" in updates and not category:
            raise ValueError("category_not_found")
        default_location_id = updates.get("default_location_id", material.default_location_id)
        if default_location_id and default_location_id not in locations:
            raise ValueError("location_not_found")

        s = self.settings
        fields: dict[str, Any] = {}
        if "name" in updates:
            fields[s.bitable_f_material_name] = updates["name"].strip()
        if "code" in updates and updates["code"]:
            fields[s.bitable_f_material_code] = updates["code"].strip()
        if "category_id" in updates:
            fields[s.bitable_f_material_category] = write_link(category_id)
            fields[s.bitable_f_material_major_category] = (
                updates.get("major_category") or (category.major_name if category else material.major_category)
            )
            fields[s.bitable_f_material_mid_category] = (
                updates.get("mid_category") or (category.mid_name if category else material.mid_category) or ""
            )
            fields[s.bitable_f_material_sub_category] = (
                updates.get("sub_category") or (category.sub_name if category else material.sub_category)
            )
        elif "major_category" in updates:
            fields[s.bitable_f_material_major_category] = updates["major_category"]
        elif "mid_category" in updates:
            fields[s.bitable_f_material_mid_category] = updates["mid_category"] or ""
        elif "sub_category" in updates:
            fields[s.bitable_f_material_sub_category] = updates["sub_category"]
        if "unit" in updates:
            fields[s.bitable_f_material_unit] = updates["unit"].strip() or "个"
        if "spec" in updates:
            fields[s.bitable_f_material_spec] = updates["spec"].strip() if updates["spec"] else ""
        if "barcode" in updates and s.bitable_f_material_barcode:
            fields[s.bitable_f_material_barcode] = updates["barcode"].strip() if updates["barcode"] else ""
        if "default_location_id" in updates:
            fields[s.bitable_f_material_default_location] = (
                write_link(default_location_id) if default_location_id else []
            )
        if "supplier" in updates:
            fields[s.bitable_f_material_supplier] = updates["supplier"].strip() if updates["supplier"] else ""
        if "min_stock" in updates and updates["min_stock"] is not None:
            fields[s.bitable_f_material_min_stock] = updates["min_stock"]

        if fields:
            rec = await self.client.update_record(s.bitable_table_materials, material_id, fields)
            self._materials_cache = None
            self._upsert_cached_record(
                s.bitable_table_materials,
                rec if rec.get("fields") else self._cached_record(material_id, fields),
            )

        refreshed = await self.get_material(material_id)
        return refreshed or material

    async def _material_stock_total(self, material_id: str) -> int:
        inv_map = await self._load_inventory_map()
        return sum(qty for key, qty in inv_map.items() if key_material_id(key) == material_id and qty > 0)

    async def _material_has_transactions(self, material_id: str) -> bool:
        s = self.settings
        for rec in await self._list_all(s.bitable_table_transactions):
            mid = field_link_id(rec.get("fields", {}).get(s.bitable_f_tx_material))
            if mid == material_id:
                return True
        if s.bitable_table_requests:
            for rec in await self._list_all(s.bitable_table_requests):
                mid = field_link_id(rec.get("fields", {}).get(s.bitable_f_request_material))
                if mid == material_id:
                    return True
        return False

    async def delete_material(self, material_id: str) -> None:
        if not await self.get_material(material_id):
            raise ValueError("material_not_found")
        stock = await self._material_stock_total(material_id)
        if stock > 0:
            raise ValueError(f"material_has_stock:{stock}")
        if await self._material_has_transactions(material_id):
            raise ValueError("material_has_transactions")
        s = self.settings
        await self.client.delete_record(s.bitable_table_materials, material_id)
        self._materials_cache = None
        self._remove_cached_record(s.bitable_table_materials, material_id)

    async def list_material_catalog(
        self,
        q: str | None = None,
        stock_only: bool = False,
    ) -> list[MaterialDetail]:
        """一次拉取物料 + 库存（出库选料、入库表单共用）。"""
        materials = list((await self._load_materials()).values())
        inv_records = await self._load_inventory_records()
        inv_map = self._inventory_map_from_records(inv_records)
        locations = await self._load_locations()
        s = self.settings

        if q:
            keyword = q.lower()
            materials = [
                m
                for m in materials
                if keyword in m.name.lower()
                or keyword in m.code.lower()
                or (m.spec and keyword in m.spec.lower())
                or (m.supplier and keyword in m.supplier.lower())
                or (m.barcode and keyword in m.barcode.lower())
                or (m.category_name and keyword in (m.category_name or "").lower())
                or (m.major_category and keyword in m.major_category.lower())
                or (m.sub_category and keyword in m.sub_category.lower())
            ]

        catalog: list[MaterialDetail] = []
        for m in sorted(materials, key=lambda x: x.name):
            items: list[InventoryItem] = []
            for key, qty in inv_map.items():
                if key_material_id(key) != m.id or qty <= 0:
                    continue
                rec = inv_records.get(key, {})
                items.append(self._inventory_item_from_record(key, rec, locations))
            total = sum(i.quantity for i in items)
            if stock_only and total <= 0:
                continue
            catalog.append(
                MaterialDetail(material=m, inventory=items, total_quantity=total)
            )
        return catalog

    async def list_locations(self) -> list[Location]:
        return list((await self._load_locations()).values())

    async def create_location(self, payload: LocationCreate) -> Location:
        locations = await self._load_locations()
        code = payload.code.strip()
        name = payload.name.strip()
        loc_type = payload.type.strip() or "货柜"
        parent_id = payload.parent_id
        if any(loc.code == code for loc in locations.values()):
            raise ValueError("location_code_exists")
        if parent_id and parent_id not in locations:
            raise ValueError("location_parent_not_found")

        major_name, mid_name, sub_name = derive_location_levels(locations, parent_id, name)
        s = self.settings
        fields = {
            s.bitable_f_location_code: code,
            s.bitable_f_location_name: name,
            s.bitable_f_location_type: loc_type,
            s.bitable_f_location_major: major_name or name,
        }
        if parent_id:
            fields[s.bitable_f_location_parent] = write_link(parent_id)
        if mid_name:
            fields[s.bitable_f_location_mid] = mid_name
        if sub_name:
            fields[s.bitable_f_location_sub] = sub_name
        rec = await self.client.create_record(s.bitable_table_locations, fields)
        rid = rec.get("record_id", "")
        self._locations_cache = None
        self._upsert_cached_record(
            s.bitable_table_locations,
            rec if rec.get("fields") else self._cached_record(rid, fields),
        )
        return Location(id=rid, code=code, name=name, type=loc_type, parent_id=parent_id, major_name=major_name or name, mid_name=mid_name, sub_name=sub_name)

    async def update_location(self, location_id: str, payload: LocationUpdate) -> Location:
        locations = await self._load_locations()
        current = locations.get(location_id)
        if not current:
            raise ValueError("location_not_found")

        code = payload.code.strip() if payload.code is not None else current.code
        name = payload.name.strip() if payload.name is not None else current.name
        loc_type = payload.type.strip() if payload.type is not None else current.type
        parent_id = payload.parent_id if "parent_id" in payload.model_dump(exclude_unset=True) else current.parent_id
        if any(loc.id != location_id and loc.code == code for loc in locations.values()):
            raise ValueError("location_code_exists")
        if parent_id and parent_id == location_id:
            raise ValueError("location_self_parent")
        if parent_id and parent_id not in locations:
            raise ValueError("location_parent_not_found")

        major_name, mid_name, sub_name = derive_location_levels(locations, parent_id, name)
        s = self.settings
        fields = {
            s.bitable_f_location_code: code,
            s.bitable_f_location_name: name,
            s.bitable_f_location_type: loc_type or "货柜",
            s.bitable_f_location_major: major_name or name,
        }
        if parent_id:
            fields[s.bitable_f_location_parent] = write_link(parent_id)
        else:
            fields[s.bitable_f_location_parent] = ""
        fields[s.bitable_f_location_mid] = mid_name or ""
        if sub_name:
            fields[s.bitable_f_location_sub] = sub_name
        rec = await self.client.update_record(s.bitable_table_locations, location_id, fields)
        self._locations_cache = None
        self._upsert_cached_record(
            s.bitable_table_locations,
            rec if rec.get("fields") else self._cached_record(location_id, fields),
        )
        return Location(id=location_id, code=code, name=name, type=loc_type or "货柜", parent_id=parent_id, major_name=major_name or name, mid_name=mid_name, sub_name=sub_name)

    async def delete_location(self, location_id: str) -> None:
        locations = await self._load_locations()
        if location_id not in locations:
            raise ValueError("location_not_found")

        # 递归删除子库位
        children = [l for l in locations.values() if l.parent_id == location_id]
        for child in children:
            await self.delete_location(child.id)

        inventory = await self._load_inventory_map()
        occupied = sum(
            qty
            for key, qty in inventory.items()
            if key_location_id(key) == location_id and qty > 0
        )
        if occupied > 0:
            raise ValueError(f"location_not_empty:{occupied}")

        s = self.settings
        await self.client.delete_record(s.bitable_table_locations, location_id)
        self._locations_cache = None
        self._remove_cached_record(s.bitable_table_locations, location_id)

    def _maybe_set_user_field(self, fields: dict[str, Any], field_name: str, open_id: str) -> bool:
        if is_feishu_user_id(open_id):
            fields[field_name] = write_user(open_id)
            return True
        return False

    def _build_tx_fields(
        self,
        tx_type: str,
        material_id: str,
        location_id: str,
        qty: int,
        operator_open_id: str,
        operator_name: str,
        remark: str | None,
    ) -> dict[str, Any]:
        s = self.settings
        effective_remark = remark or ""
        fields: dict[str, Any] = {
            s.bitable_f_tx_type: tx_type,
            s.bitable_f_tx_material: write_link(material_id),
            s.bitable_f_tx_location: write_link(location_id),
            s.bitable_f_tx_quantity: qty,
        }
        if not self._maybe_set_user_field(fields, s.bitable_f_tx_operator, operator_open_id):
            effective_remark = append_operator_label(effective_remark, operator_name)
        fields[s.bitable_f_tx_remark] = effective_remark
        return fields

    async def _write_inventory_quantity(
        self,
        inv_records: dict[InventoryKey, dict[str, Any]],
        material_id: str,
        location_id: str,
        qty: int,
        updated_at: int,
        row: int | None = None,
        column: int | None = None,
    ) -> str:
        if self._slots_enabled() and ((row is None) ^ (column is None)):
            raise ValueError("slot_incomplete")
        s = self.settings
        key = self._inv_key(material_id, location_id, row, column)
        inv_fields: dict[str, Any] = {
            s.bitable_f_inventory_quantity: qty,
            s.bitable_f_inventory_updated: updated_at,
        }
        if self._slots_enabled() and row is not None and column is not None:
            inv_fields[s.bitable_f_inventory_row] = row
            inv_fields[s.bitable_f_inventory_column] = column
        if key in inv_records:
            record_id = inv_records[key]["record_id"]
            await self.client.update_record(
                s.bitable_table_inventory,
                record_id,
                inv_fields,
            )
            self._upsert_cached_record(
                s.bitable_table_inventory,
                self._cached_record(record_id, inv_fields),
            )
            inv_records[key] = self._cached_record(record_id, inv_fields)
            return record_id

        inv_fields[s.bitable_f_inventory_material] = write_link(material_id)
        inv_fields[s.bitable_f_inventory_location] = write_link(location_id)
        inv_rec = await self.client.create_record(s.bitable_table_inventory, inv_fields)
        record_id = inv_rec.get("record_id", "")
        self._upsert_cached_record(
            s.bitable_table_inventory,
            inv_rec if inv_rec.get("fields") else self._cached_record(record_id, inv_fields),
        )
        inv_records[key] = self._cached_record(record_id, inv_fields)
        return record_id

    async def _load_inventory_map(self) -> dict[InventoryKey, int]:
        return self._inventory_map_from_records(await self._load_inventory_records())

    def _inventory_map_from_records(
        self, records: dict[InventoryKey, dict[str, Any]]
    ) -> dict[InventoryKey, int]:
        s = self.settings
        result: dict[InventoryKey, int] = {}
        for key, rec in records.items():
            result[key] = field_number(rec.get("fields", {}).get(s.bitable_f_inventory_quantity))
        return result

    async def _load_inventory_records(self) -> dict[InventoryKey, dict[str, Any]]:
        s = self.settings
        records = await self._list_all(s.bitable_table_inventory)
        result: dict[InventoryKey, dict[str, Any]] = {}
        for rec in records:
            fields = rec.get("fields", {})
            mid = field_link_id(fields.get(s.bitable_f_inventory_material))
            lid = field_link_id(fields.get(s.bitable_f_inventory_location))
            if not mid or not lid:
                continue
            row, column = self._read_inventory_slot(fields)
            key = self._inv_key(mid, lid, row, column)
            result[key] = rec
        return result

    async def update_inventory_slot(
        self,
        material_id: str,
        location_id: str,
        row: int,
        column: int,
        from_row: int | None = None,
        from_column: int | None = None,
    ) -> InventoryItem:
        if not self._slots_enabled():
            raise ValueError("slots_not_enabled")
        if not await self.get_material(material_id):
            raise ValueError("material_not_found")
        locations = await self._load_locations()
        if location_id not in locations:
            raise ValueError("location_not_found")

        inv_records = await self._load_inventory_records()
        try:
            old_key, old_rec = self._resolve_inventory_record(
                inv_records, material_id, location_id, from_row, from_column
            )
        except ValueError as exc:
            raise ValueError("inventory_not_found") from exc
        new_key = self._inv_key(material_id, location_id, row, column)
        s = self.settings
        old_qty = field_number(old_rec.get("fields", {}).get(s.bitable_f_inventory_quantity))
        if old_qty <= 0:
            raise ValueError("inventory_not_found")

        updated_at = int(datetime.now(timezone.utc).timestamp() * 1000)
        old_record_id = old_rec.get("record_id", "")

        if old_key == new_key:
            inv_fields = {
                s.bitable_f_inventory_row: row,
                s.bitable_f_inventory_column: column,
                s.bitable_f_inventory_updated: updated_at,
            }
            await self.client.update_record(s.bitable_table_inventory, old_record_id, inv_fields)
            self._upsert_cached_record(
                s.bitable_table_inventory,
                self._cached_record(old_record_id, inv_fields),
            )
        elif new_key in inv_records:
            target_rec = inv_records[new_key]
            target_id = target_rec.get("record_id", "")
            target_qty = field_number(target_rec.get("fields", {}).get(s.bitable_f_inventory_quantity))
            await self.client.update_record(
                s.bitable_table_inventory,
                target_id,
                {
                    s.bitable_f_inventory_quantity: target_qty + old_qty,
                    s.bitable_f_inventory_updated: updated_at,
                },
            )
            await self.client.delete_record(s.bitable_table_inventory, old_record_id)
            self._invalidate_table_cache(s.bitable_table_inventory)
        else:
            inv_fields = {
                s.bitable_f_inventory_row: row,
                s.bitable_f_inventory_column: column,
                s.bitable_f_inventory_updated: updated_at,
            }
            await self.client.update_record(s.bitable_table_inventory, old_record_id, inv_fields)
            self._upsert_cached_record(
                s.bitable_table_inventory,
                self._cached_record(old_record_id, inv_fields),
            )

        self._invalidate_table_cache(s.bitable_table_inventory)
        items = await self.get_inventory_for_material(material_id)
        for item in items:
            if item.location_id == location_id and item.row == row and item.column == column:
                return item
        raise ValueError("inventory_not_found")

    async def get_inventory_for_material(self, material_id: str) -> list[InventoryItem]:
        locations = await self._load_locations()
        inv_records = await self._load_inventory_records()
        inv_map = self._inventory_map_from_records(inv_records)
        items: list[InventoryItem] = []
        for key, qty in inv_map.items():
            if key_material_id(key) != material_id or qty <= 0:
                continue
            rec = inv_records.get(key, {})
            items.append(self._inventory_item_from_record(key, rec, locations))
        return items

    async def list_inventory(
        self, material_id: str | None, location_id: str | None
    ) -> list[InventoryItem]:
        locations = await self._load_locations()
        inv_records = await self._load_inventory_records()
        all_items: list[InventoryItem] = []
        for key, rec in inv_records.items():
            if material_id and key_material_id(key) != material_id:
                continue
            if location_id and key_location_id(key) != location_id:
                continue
            fields = rec.get("fields", {})
            qty = field_number(fields.get(self.settings.bitable_f_inventory_quantity))
            if qty <= 0:
                continue
            all_items.append(self._inventory_item_from_record(key, rec, locations))
        return all_items

    async def get_transactions(self, material_id: str, limit: int) -> list[Transaction]:
        s = self.settings
        materials = await self._load_materials()
        locations = await self._load_locations()
        records = await self._list_all(s.bitable_table_transactions)
        txs: list[Transaction] = []
        for rec in records:
            fields = rec.get("fields", {})
            mid = field_link_id(fields.get(s.bitable_f_tx_material))
            if mid != material_id:
                continue
            lid = field_link_id(fields.get(s.bitable_f_tx_location)) or ""
            tx_type_raw = field_text(fields.get(s.bitable_f_tx_type)) or "out"
            normalized = normalize_tx_type(tx_type_raw)
            if normalized == "入库":
                tx_enum = TransactionType.INBOUND
            elif normalized == "移动":
                tx_enum = TransactionType.TRANSFER
            else:
                tx_enum = TransactionType.OUTBOUND
            created_at = self._parse_transaction_created_at(rec, fields)
            material = materials.get(mid)
            loc = locations.get(lid)
            txs.append(
                Transaction(
                    id=rec["record_id"],
                    type=tx_enum,
                    material_id=mid,
                    material_name=material.name if material else None,
                    location_id=lid,
                    location_name=loc.name if loc else lid,
                    quantity=field_number(fields.get(s.bitable_f_tx_quantity)),
                    operator=resolve_person_name(
                        fields.get(s.bitable_f_tx_operator),
                        field_text(fields.get(s.bitable_f_tx_remark)),
                        remark_prefix="操作人",
                    ),
                    remark=field_text(fields.get(s.bitable_f_tx_remark)),
                    created_at=created_at,
                )
            )
        txs.sort(key=lambda t: t.created_at, reverse=True)
        return txs[:limit]

    async def list_transactions(
        self,
        *,
        operator: str | None = None,
        keyword: str | None = None,
        start_at: datetime | None = None,
        end_at: datetime | None = None,
        limit: int = 100,
    ) -> list[Transaction]:
        s = self.settings
        materials = await self._load_materials()
        locations = await self._load_locations()
        records = await self._list_all(s.bitable_table_transactions)
        txs: list[Transaction] = []
        for rec in records:
            fields = rec.get("fields", {})
            mid = field_link_id(fields.get(s.bitable_f_tx_material)) or ""
            lid = field_link_id(fields.get(s.bitable_f_tx_location)) or ""
            tx_type_raw = field_text(fields.get(s.bitable_f_tx_type)) or "out"
            normalized = normalize_tx_type(tx_type_raw)
            if normalized == "入库":
                tx_enum = TransactionType.INBOUND
            elif normalized == "移动":
                tx_enum = TransactionType.TRANSFER
            else:
                tx_enum = TransactionType.OUTBOUND
            created_at = self._parse_transaction_created_at(rec, fields)
            material = materials.get(mid)
            loc = locations.get(lid)
            tx_remark = field_text(fields.get(s.bitable_f_tx_remark))
            tx = Transaction(
                id=rec["record_id"],
                type=tx_enum,
                material_id=mid,
                material_name=material.name if material else None,
                location_id=lid,
                location_name=loc.name if loc else lid,
                quantity=field_number(fields.get(s.bitable_f_tx_quantity)),
                operator=resolve_person_name(
                    fields.get(s.bitable_f_tx_operator),
                    tx_remark,
                    remark_prefix="操作人",
                ),
                remark=tx_remark,
                created_at=created_at,
            )
            txs.append(tx)

        if operator:
            txs = [tx for tx in txs if tx.operator == operator]
        if start_at:
            txs = [tx for tx in txs if tx.created_at >= start_at]
        if end_at:
            txs = [tx for tx in txs if tx.created_at <= end_at]
        if keyword:
            text = keyword.lower()
            txs = [
                tx
                for tx in txs
                if text in (tx.material_name or "").lower()
                or text in (tx.location_name or "").lower()
                or text in tx.operator.lower()
                or text in (tx.remark or "").lower()
            ]
        txs.sort(key=lambda t: t.created_at, reverse=True)
        return txs[:limit]

    def _require_requests_table(self) -> None:
        if not self.settings.bitable_table_requests:
            raise RuntimeError("Bitable 申请表未配置，请设置 BITABLE_TABLE_REQUESTS")

    @staticmethod
    def _parse_request_type(value: Any) -> StockRequestType:
        raw = (field_text(value) or "").strip().lower()
        if raw in {"in", "入库", "inbound"}:
            return StockRequestType.INBOUND
        if raw in {"out", "出库", "outbound"}:
            return StockRequestType.OUTBOUND
        return StockRequestType.OUTBOUND

    @staticmethod
    def _parse_request_status(value: Any) -> StockRequestStatus:
        raw = (field_text(value) or "").strip().lower()
        if raw in {"approved", "approve", "已通过", "通过"}:
            return StockRequestStatus.APPROVED
        if raw in {"rejected", "reject", "已拒绝", "拒绝"}:
            return StockRequestStatus.REJECTED
        return StockRequestStatus.PENDING

    @staticmethod
    def _parse_bitable_datetime(value: Any) -> datetime | None:
        if isinstance(value, (int, float)):
            return datetime.fromtimestamp(value / 1000, tz=timezone.utc)
        if isinstance(value, str) and value.strip():
            raw = value.strip().replace("Z", "+00:00")
            try:
                parsed = datetime.fromisoformat(raw)
            except ValueError:
                return None
            if parsed.tzinfo is None:
                return parsed.replace(tzinfo=timezone.utc)
            return parsed
        return None

    def _parse_transaction_created_at(self, rec: dict[str, Any], fields: dict[str, Any]) -> datetime:
        """优先读业务时间列，否则用 Bitable 记录 created_time（勿 fallback 到 now）。"""
        s = self.settings
        field_names = [s.bitable_f_tx_created, "创建时间", "交易时间"]
        seen: set[str] = set()
        for name in field_names:
            key = (name or "").strip()
            if not key or key in seen:
                continue
            seen.add(key)
            parsed = self._parse_bitable_datetime(fields.get(key))
            if parsed:
                return parsed
        record_ts = rec.get("created_time")
        if isinstance(record_ts, (int, float)):
            return datetime.fromtimestamp(record_ts / 1000, tz=timezone.utc)
        return datetime.fromtimestamp(0, tz=timezone.utc)

    def _parse_request(self, rec: dict[str, Any], materials: dict[str, Material], locations: dict[str, Location]) -> StockRequest:
        s = self.settings
        fields = rec.get("fields", {})
        mid = field_link_id(fields.get(s.bitable_f_request_material)) or ""
        lid = field_link_id(fields.get(s.bitable_f_request_location)) or None
        req_type = self._parse_request_type(fields.get(s.bitable_f_request_type))
        status = self._parse_request_status(fields.get(s.bitable_f_request_status))
        created_at = self._parse_bitable_datetime(fields.get(s.bitable_f_request_created)) or datetime.now(timezone.utc)
        reviewed_at = self._parse_bitable_datetime(fields.get(s.bitable_f_request_reviewed))
        material = materials.get(mid)
        location = locations.get(lid) if lid else None
        raw_remark = field_text(fields.get(s.bitable_f_request_remark))
        requester_name = resolve_person_name(
            fields.get(s.bitable_f_request_requester),
            raw_remark,
            remark_prefix="申请人",
        )
        requester_open_id = field_user_id(fields.get(s.bitable_f_request_requester)) or ""
        approver_open_id = field_user_id(fields.get(s.bitable_f_request_approver))
        approver_name = field_user_name(fields.get(s.bitable_f_request_approver))
        remark, row, column, return_required, return_due_at = parse_request_remark(raw_remark)
        return StockRequest(
            id=rec["record_id"],
            type=req_type,
            status=status,
            material_id=mid,
            material_name=material.name if material else None,
            location_id=lid,
            location_name=location.name if location else None,
            quantity=field_number(fields.get(s.bitable_f_request_quantity)),
            requester_open_id=requester_open_id,
            requester_name=requester_name,
            approver_open_id=approver_open_id,
            approver_name=approver_name,
            remark=remark,
            reject_reason=field_text(fields.get(s.bitable_f_request_reject_reason)),
            return_required=return_required,
            return_due_at=return_due_at,
            row=row,
            column=column,
            transaction_id=field_text(fields.get(s.bitable_f_request_transaction)),
            created_at=created_at,
            reviewed_at=reviewed_at,
        )

    async def create_request(
        self,
        payload: StockRequestCreate,
        requester_open_id: str,
        requester_name: str,
    ) -> StockRequest:
        self._require_requests_table()
        material = await self.get_material(payload.material_id)
        if not material:
            raise ValueError("material_not_found")
        locations = await self._load_locations()
        location = locations.get(payload.location_id) if payload.location_id else None
        if payload.type == StockRequestType.OUTBOUND:
            if not location:
                raise ValueError("location_not_found")
        elif payload.location_id and not location:
            raise ValueError("location_not_found")

        s = self.settings
        remark = format_request_remark(payload)
        fields: dict[str, Any] = {
            s.bitable_f_request_type: payload.type.value,
            s.bitable_f_request_status: StockRequestStatus.PENDING.value,
            s.bitable_f_request_material: write_link(payload.material_id),
            s.bitable_f_request_quantity: payload.qty,
            s.bitable_f_request_remark: remark,
        }
        if payload.location_id:
            fields[s.bitable_f_request_location] = write_link(payload.location_id)
        if not self._maybe_set_user_field(fields, s.bitable_f_request_requester, requester_open_id):
            fields[s.bitable_f_request_remark] = append_operator_label(
                fields[s.bitable_f_request_remark],
                requester_name,
                prefix="申请人",
            )

        rec = await self.client.create_record(s.bitable_table_requests, fields)
        self._upsert_cached_record(
            s.bitable_table_requests,
            rec if rec.get("fields") else self._cached_record(rec.get("record_id", ""), fields),
        )
        return StockRequest(
            id=rec.get("record_id", "req_new"),
            type=payload.type,
            status=StockRequestStatus.PENDING,
            material_id=payload.material_id,
            material_name=material.name,
            location_id=payload.location_id,
            location_name=location.name if location else None,
            quantity=payload.qty,
            requester_open_id=requester_open_id,
            requester_name=requester_name,
            remark=payload.note,
            return_required=payload.return_required,
            return_due_at=payload.return_due_at,
            row=payload.row,
            column=payload.column,
            created_at=datetime.now(timezone.utc),
        )

    @staticmethod
    def _format_request_remark(payload: StockRequestCreate) -> str:
        return format_request_remark(payload)

    async def list_requests(
        self,
        *,
        requester_open_id: str | None = None,
        requester_name: str | None = None,
        status: StockRequestStatus | None = None,
        keyword: str | None = None,
        limit: int = 100,
    ) -> list[StockRequest]:
        self._require_requests_table()
        materials = await self._load_materials()
        locations = await self._load_locations()
        records = await self._list_all(self.settings.bitable_table_requests)
        items = [self._parse_request(rec, materials, locations) for rec in records]
        if requester_name:
            items = [item for item in items if item.requester_name == requester_name]
        if requester_open_id:
            items = [
                item for item in items if not item.requester_open_id or item.requester_open_id == requester_open_id
            ]
        if status:
            items = [item for item in items if item.status == status]
        if keyword:
            text = keyword.lower()
            items = [
                item
                for item in items
                if text in (item.material_name or "").lower()
                or text in (item.location_name or "").lower()
                or text in item.requester_name.lower()
                or text in (item.remark or "").lower()
            ]
        items.sort(key=lambda item: item.created_at, reverse=True)
        return items[:limit]

    async def approve_request(
        self,
        request_id: str,
        approver_open_id: str,
        approver_name: str,
        *,
        location_id: str | None = None,
        row: int | None = None,
        column: int | None = None,
    ) -> StockRequest:
        self._require_requests_table()
        materials = await self._load_materials()
        locations = await self._load_locations()
        records = await self._list_all(self.settings.bitable_table_requests)
        rec = next((item for item in records if item.get("record_id") == request_id), None)
        if not rec:
            raise ValueError("request_not_found")
        req = self._parse_request(rec, materials, locations)
        if req.status != StockRequestStatus.PENDING:
            raise ValueError("request_already_reviewed")

        approval_note = f"{req.remark or ''}；审批人：{approver_name}".strip("；")
        requester_open_id = req.requester_open_id or ""
        if req.type == StockRequestType.INBOUND:
            target_location_id = location_id or req.location_id
            if not target_location_id or target_location_id not in locations:
                raise ValueError("location_required_for_inbound_approval")
            tx = await self.apply_inbound(
                req.material_id,
                target_location_id,
                req.quantity,
                requester_open_id,
                req.requester_name,
                approval_note,
                row=row,
                column=column,
            )
            target_location = locations[target_location_id]
        else:
            if not req.location_id or req.location_id not in locations:
                raise ValueError("location_not_found")
            inv_records = await self._load_inventory_records()
            inv_map = self._inventory_map_from_records(inv_records)
            out_row = row if row is not None else req.row
            out_column = column if column is not None else req.column
            out_row, out_column = resolve_outbound_slot(
                inv_map,
                req.material_id,
                req.location_id,
                req.quantity,
                out_row,
                out_column,
                slots_enabled=self._slots_enabled(),
            )
            tx = await self.apply_outbound(
                req.material_id,
                req.location_id,
                req.quantity,
                requester_open_id,
                req.requester_name,
                approval_note,
                row=out_row,
                column=out_column,
            )
            target_location_id = req.location_id
            target_location = locations[target_location_id]

        reviewed_at = int(datetime.now(timezone.utc).timestamp() * 1000)
        s = self.settings
        fields: dict[str, Any] = {
            s.bitable_f_request_status: StockRequestStatus.APPROVED.value,
            s.bitable_f_request_transaction: tx.id,
            s.bitable_f_request_reviewed: reviewed_at,
            s.bitable_f_request_location: write_link(target_location_id),
        }
        self._maybe_set_user_field(fields, s.bitable_f_request_approver, approver_open_id)
        updated_rec = await self.client.update_record(s.bitable_table_requests, request_id, fields)
        self._upsert_cached_record(
            s.bitable_table_requests,
            updated_rec if updated_rec.get("fields") else self._cached_record(request_id, fields),
        )
        return req.model_copy(
            update={
                "status": StockRequestStatus.APPROVED,
                "location_id": target_location_id,
                "location_name": target_location.name,
                "approver_open_id": approver_open_id,
                "approver_name": approver_name,
                "transaction_id": tx.id,
                "reviewed_at": datetime.fromtimestamp(reviewed_at / 1000, tz=timezone.utc),
            }
        )

    async def reject_request(
        self,
        request_id: str,
        approver_open_id: str,
        approver_name: str,
        reason: str,
    ) -> StockRequest:
        self._require_requests_table()
        materials = await self._load_materials()
        locations = await self._load_locations()
        records = await self._list_all(self.settings.bitable_table_requests)
        rec = next((item for item in records if item.get("record_id") == request_id), None)
        if not rec:
            raise ValueError("request_not_found")
        req = self._parse_request(rec, materials, locations)
        if req.status != StockRequestStatus.PENDING:
            raise ValueError("request_already_reviewed")

        reviewed_at = int(datetime.now(timezone.utc).timestamp() * 1000)
        s = self.settings
        fields: dict[str, Any] = {
            s.bitable_f_request_status: StockRequestStatus.REJECTED.value,
            s.bitable_f_request_reject_reason: reason,
            s.bitable_f_request_reviewed: reviewed_at,
        }
        if not self._maybe_set_user_field(fields, s.bitable_f_request_approver, approver_open_id):
            fields[s.bitable_f_request_reject_reason] = append_operator_label(
                reason,
                approver_name,
                prefix="审批人",
            )
        updated_rec = await self.client.update_record(s.bitable_table_requests, request_id, fields)
        self._upsert_cached_record(
            s.bitable_table_requests,
            updated_rec if updated_rec.get("fields") else self._cached_record(request_id, fields),
        )
        return req.model_copy(
            update={
                "status": StockRequestStatus.REJECTED,
                "approver_open_id": approver_open_id,
                "approver_name": approver_name,
                "reject_reason": reason,
                "reviewed_at": datetime.fromtimestamp(reviewed_at / 1000, tz=timezone.utc),
            }
        )

    async def apply_inbound(
        self,
        material_id: str,
        location_id: str,
        qty: int,
        operator_open_id: str,
        operator_name: str,
        remark: str | None,
        row: int | None = None,
        column: int | None = None,
    ) -> Transaction:
        if not await self.get_material(material_id):
            raise ValueError("material_not_found")
        locations = await self._load_locations()
        if location_id not in locations:
            raise ValueError("location_not_found")
        if self._slots_enabled() and ((row is None) ^ (column is None)):
            raise ValueError("slot_incomplete")

        inv_records = await self._load_inventory_records()
        key = self._inv_key(material_id, location_id, row, column)
        s = self.settings
        current = field_number(
            inv_records.get(key, {}).get("fields", {}).get(s.bitable_f_inventory_quantity)
        )
        new_qty = current + qty
        updated_at = int(datetime.now(timezone.utc).timestamp() * 1000)

        await self._write_inventory_quantity(
            inv_records, material_id, location_id, new_qty, updated_at, row=row, column=column
        )

        tx_fields = self._build_tx_fields(
            s.bitable_v_tx_inbound,
            material_id,
            location_id,
            qty,
            operator_open_id,
            operator_name,
            remark,
        )
        try:
            tx_rec = await self.client.create_record(s.bitable_table_transactions, tx_fields)
        except Exception:
            await self._write_inventory_quantity(
                inv_records, material_id, location_id, current, updated_at, row=row, column=column
            )
            raise
        self._upsert_cached_record(
            s.bitable_table_transactions,
            tx_rec if tx_rec.get("fields") else self._cached_record(tx_rec.get("record_id", ""), tx_fields),
        )
        material = (await self._load_materials())[material_id]
        loc = locations[location_id]
        tx_record = tx_rec if tx_rec.get("fields") else self._cached_record(tx_rec.get("record_id", ""), tx_fields)
        return Transaction(
            id=tx_rec.get("record_id", "tx_new"),
            type=TransactionType.INBOUND,
            material_id=material_id,
            material_name=material.name,
            location_id=location_id,
            location_name=loc.name,
            quantity=qty,
            operator=operator_name,
            remark=remark,
            created_at=self._parse_transaction_created_at(tx_record, tx_record.get("fields", {})),
        )

    async def apply_outbound(
        self,
        material_id: str,
        location_id: str,
        qty: int,
        operator_open_id: str,
        operator_name: str,
        remark: str | None,
        row: int | None = None,
        column: int | None = None,
    ) -> Transaction:
        if not await self.get_material(material_id):
            raise ValueError("material_not_found")
        inv_records = await self._load_inventory_records()
        inv_map = self._inventory_map_from_records(inv_records)
        out_row, out_column = resolve_outbound_slot(
            inv_map,
            material_id,
            location_id,
            qty,
            row,
            column,
            slots_enabled=self._slots_enabled(),
        )
        key = self._inv_key(material_id, location_id, out_row, out_column)
        s = self.settings
        if key not in inv_records:
            available = inv_map.get(key, 0)
            raise ValueError(f"insufficient_stock:{available}")
        current = field_number(inv_records[key]["fields"].get(s.bitable_f_inventory_quantity))
        if current < qty:
            raise ValueError(f"insufficient_stock:{current}")

        updated_at = int(datetime.now(timezone.utc).timestamp() * 1000)
        await self._write_inventory_quantity(
            inv_records,
            material_id,
            location_id,
            current - qty,
            updated_at,
            row=out_row,
            column=out_column,
        )
        tx_fields = self._build_tx_fields(
            s.bitable_v_tx_outbound,
            material_id,
            location_id,
            -qty,
            operator_open_id,
            operator_name,
            remark,
        )
        try:
            tx_rec = await self.client.create_record(s.bitable_table_transactions, tx_fields)
        except Exception:
            await self._write_inventory_quantity(
                inv_records,
                material_id,
                location_id,
                current,
                updated_at,
                row=out_row,
                column=out_column,
            )
            raise
        self._upsert_cached_record(
            s.bitable_table_transactions,
            tx_rec if tx_rec.get("fields") else self._cached_record(tx_rec.get("record_id", ""), tx_fields),
        )
        materials = await self._load_materials()
        locations = await self._load_locations()
        tx_record = tx_rec if tx_rec.get("fields") else self._cached_record(tx_rec.get("record_id", ""), tx_fields)
        return Transaction(
            id=tx_rec.get("record_id", "tx_new"),
            type=TransactionType.OUTBOUND,
            material_id=material_id,
            material_name=materials[material_id].name,
            location_id=location_id,
            location_name=locations.get(location_id, Location(id=location_id, code="", name=location_id)).name,
            quantity=-qty,
            operator=operator_name,
            remark=remark,
            created_at=self._parse_transaction_created_at(tx_record, tx_record.get("fields", {})),
        )

    async def apply_transfer(
        self,
        material_id: str,
        from_location_id: str,
        to_location_id: str,
        qty: int,
        operator_open_id: str,
        operator_name: str,
        remark: str | None,
        to_row: int | None = None,
        to_column: int | None = None,
        from_row: int | None = None,
        from_column: int | None = None,
    ) -> list[Transaction]:
        if from_location_id == to_location_id:
            raise ValueError("same_location")
        if not await self.get_material(material_id):
            raise ValueError("material_not_found")
        if self._slots_enabled():
            if (from_row is None) ^ (from_column is None) or (to_row is None) ^ (to_column is None):
                raise ValueError("slot_incomplete")

        locations = await self._load_locations()
        if from_location_id not in locations or to_location_id not in locations:
            raise ValueError("location_not_found")

        inv_records = await self._load_inventory_records()
        inv_map = self._inventory_map_from_records(inv_records)
        out_row, out_column = resolve_outbound_slot(
            inv_map,
            material_id,
            from_location_id,
            qty,
            from_row,
            from_column,
            slots_enabled=self._slots_enabled(),
        )
        source_key = self._inv_key(material_id, from_location_id, out_row, out_column)
        target_key = self._inv_key(material_id, to_location_id, to_row, to_column)
        s = self.settings
        source_current = field_number(
            inv_records.get(source_key, {}).get("fields", {}).get(s.bitable_f_inventory_quantity)
        )
        if source_current < qty:
            raise ValueError(f"insufficient_stock:{source_current}")
        target_current = field_number(
            inv_records.get(target_key, {}).get("fields", {}).get(s.bitable_f_inventory_quantity)
        )

        updated_at = int(datetime.now(timezone.utc).timestamp() * 1000)
        await self._write_inventory_quantity(
            inv_records,
            material_id,
            from_location_id,
            source_current - qty,
            updated_at,
            row=out_row,
            column=out_column,
        )
        try:
            await self._write_inventory_quantity(
                inv_records,
                material_id,
                to_location_id,
                target_current + qty,
                updated_at,
                row=to_row,
                column=to_column,
            )
        except Exception:
            await self._write_inventory_quantity(
                inv_records,
                material_id,
                from_location_id,
                source_current,
                updated_at,
                row=out_row,
                column=out_column,
            )
            raise

        source_loc = locations[from_location_id]
        target_loc = locations[to_location_id]
        tx_fields = self._build_tx_fields(
            s.bitable_v_tx_transfer,
            material_id,
            from_location_id,
            -qty,
            operator_open_id,
            operator_name,
            f"移动至 {target_loc.name}" + (f"；{remark}" if remark else ""),
        )
        try:
            tx_rec = await self.client.create_record(s.bitable_table_transactions, tx_fields)
        except Exception:
            await self._write_inventory_quantity(
                inv_records,
                material_id,
                from_location_id,
                source_current,
                updated_at,
                row=out_row,
                column=out_column,
            )
            await self._write_inventory_quantity(
                inv_records,
                material_id,
                to_location_id,
                target_current,
                updated_at,
                row=to_row,
                column=to_column,
            )
            raise

        self._upsert_cached_record(
            s.bitable_table_transactions,
            tx_rec if tx_rec.get("fields") else self._cached_record(tx_rec.get("record_id", ""), tx_fields),
        )

        material = (await self._load_materials())[material_id]
        tx_record = tx_rec if tx_rec.get("fields") else self._cached_record(tx_rec.get("record_id", ""), tx_fields)
        created_at = self._parse_transaction_created_at(tx_record, tx_record.get("fields", {}))
        return [
            Transaction(
                id=tx_rec.get("record_id", "tx_transfer"),
                type=TransactionType.TRANSFER,
                material_id=material_id,
                material_name=material.name,
                location_id=from_location_id,
                location_name=source_loc.name,
                quantity=-qty,
                operator=operator_name,
                remark=tx_fields.get(s.bitable_f_tx_remark),
                created_at=created_at,
            ),
        ]

    # ── 管理员纠错方法 ──

    async def update_transaction(self, transaction_id: str, payload: TransactionUpdate) -> Transaction:
        s = self.settings
        fields: dict[str, Any] = {}
        if payload.quantity is not None:
            fields[s.bitable_f_tx_quantity] = payload.quantity
        if payload.material_id is not None:
            fields[s.bitable_f_tx_material] = write_link(payload.material_id)
        if payload.location_id is not None:
            fields[s.bitable_f_tx_location] = write_link(payload.location_id)
        if payload.remark is not None:
            fields[s.bitable_f_tx_remark] = payload.remark
        if fields:
            rec = await self.client.update_record(s.bitable_table_transactions, transaction_id, fields)
            self._invalidate_table_cache(s.bitable_table_transactions)
        # 返回更新后的对象（简化：返回 payload 合并到原始查询）
        return Transaction(
            id=transaction_id,
            type=TransactionType.INBOUND,
            material_id=payload.material_id or "",
            location_id=payload.location_id or "",
            quantity=payload.quantity or 0,
            operator="",
            remark=payload.remark,
            created_at=datetime.now(timezone.utc),
        )

    async def update_request(self, request_id: str, payload: StockRequestUpdate) -> StockRequest:
        s = self.settings
        fields: dict[str, Any] = {}
        if payload.quantity is not None:
            fields[s.bitable_f_request_quantity] = payload.quantity
        if payload.material_id is not None:
            fields[s.bitable_f_request_material] = write_link(payload.material_id)
        if payload.location_id is not None:
            fields[s.bitable_f_request_location] = write_link(payload.location_id)
        if payload.remark is not None:
            fields[s.bitable_f_request_remark] = payload.remark
        if fields:
            rec = await self.client.update_record(s.bitable_table_requests, request_id, fields)
            self._invalidate_table_cache(s.bitable_table_requests)
        return StockRequest(
            id=request_id,
            type=StockRequestType.INBOUND,
            status=StockRequestStatus.PENDING,
            material_id=payload.material_id or "",
            location_id=payload.location_id,
            quantity=payload.quantity or 0,
            requester_open_id="",
            requester_name="",
            remark=payload.remark,
            created_at=datetime.now(timezone.utc),
        )

    async def update_inventory_record(
        self, material_id: str, location_id: str, payload: InventoryRecordUpdate,
        row: int | None = None, column: int | None = None,
    ) -> InventoryItem:
        s = self.settings
        inv_records = await self._load_inventory_records()
        key = self._inv_key(material_id, location_id, row, column)
        rec = inv_records.get(key)
        if not rec:
            raise ValueError("inventory_not_found")
        record_id = rec.get("record_id", "")
        fields = {s.bitable_f_inventory_quantity: payload.quantity}
        if payload.remark:
            fields[s.bitable_f_tx_remark] = payload.remark
        await self.client.update_record(s.bitable_table_inventory, record_id, fields)
        self._invalidate_table_cache(s.bitable_table_inventory)
        return InventoryItem(
            material_id=material_id,
            location_id=location_id,
            location_name="",
            quantity=payload.quantity,
            row=row,
            column=column,
            last_updated=datetime.now(timezone.utc),
        )

    def _invalidate_cache(self, *table_ids: str) -> None:
        s = self.settings
        if not table_ids or s.bitable_table_materials in table_ids:
            self._materials_cache = None
        if not table_ids or s.bitable_table_locations in table_ids:
            self._locations_cache = None
        self._invalidate_table_cache(*(table_ids or tuple(self._core_table_ids())))

    # ── SQLite 本地缓存同步 ──

    def _sqlite_enabled(self) -> bool:
        return (
            self.settings.sqlite_cache_enabled
            and self.settings.bitable_mode == "real"
            and bool(self.settings.bitable_app_token)  # 测试用假 token 跳过
            and self.settings.bitable_configured
        )

    def _sync_sqlite_upsert(self, table_id: str, record: dict[str, Any]) -> None:
        """单条写入 SQLite（写操作后同步调用）。"""
        if not table_id or not record.get("record_id"):
            return
        if not self._sqlite_enabled():
            return
        try:
            from app.bitable.sqlite_cache import get_sqlite_cache
            get_sqlite_cache().upsert_one(table_id, record)
        except Exception:
            pass

    def _sync_sqlite_upsert_all(self, table_id: str, records: list[dict[str, Any]]) -> None:
        """批量写入 SQLite。"""
        if not table_id or not records:
            return
        if not self._sqlite_enabled():
            return
        try:
            from app.bitable.sqlite_cache import get_sqlite_cache
            get_sqlite_cache().upsert_records(table_id, records)
        except Exception:
            pass

    def _sync_sqlite_delete(self, table_id: str, record_id: str) -> None:
        """从 SQLite 删除一条记录。"""
        if not table_id or not record_id:
            return
        if not self._sqlite_enabled():
            return
        try:
            from app.bitable.sqlite_cache import get_sqlite_cache
            get_sqlite_cache().delete_one(table_id, record_id)
        except Exception:
            pass

    async def snapshot(self) -> dict[str, int]:
        return {
            "materials": len(await self._load_materials()),
            "locations": len(await self._load_locations()),
            "inventory": len(await self._load_inventory_map()),
        }

    # ── 库位类型管理（real 模式：从 locations 表派生 + 内存预设） ──

    _location_type_presets: list[str] | None = None

    def _default_location_types(self) -> list[str]:
        return ["货柜", "货架", "专用螺栓架", "工具架", "快递暂存"]

    async def list_location_types(self) -> list[str]:
        """获取所有库位类型（locations 表已有类型 + 管理员预设）"""
        locations = await self._load_locations()
        used_types = {loc.type for loc in locations.values() if loc.type}
        presets = self._location_type_presets if self._location_type_presets is not None else self._default_location_types()
        merged = sorted(set(presets) | used_types)
        return merged

    def _save_presets(self, types: list[str]) -> None:
        self._location_type_presets = types

    async def add_location_type(self, name: str) -> list[str]:
        name = name.strip()
        if not name:
            raise ValueError("location_type_name_empty")
        current = await self.list_location_types()
        if name in current:
            raise ValueError("location_type_exists")
        presets = self._location_type_presets if self._location_type_presets is not None else self._default_location_types()
        presets.append(name)
        self._save_presets(presets)
        return await self.list_location_types()

    async def remove_location_type(self, name: str) -> list[str]:
        name = name.strip()
        locations = await self._load_locations()
        if any(loc.type == name for loc in locations.values()):
            raise ValueError("location_type_in_use")
        presets = self._location_type_presets if self._location_type_presets is not None else self._default_location_types()
        if name not in presets:
            raise ValueError("location_type_not_found")
        presets.remove(name)
        self._save_presets(presets)
        return await self.list_location_types()

    async def update_location_type(self, old_name: str, new_name: str) -> list[str]:
        old_name = old_name.strip()
        new_name = new_name.strip()
        presets = self._location_type_presets if self._location_type_presets is not None else self._default_location_types()
        if old_name not in presets:
            raise ValueError("location_type_not_found")
        if new_name in presets:
            raise ValueError("location_type_exists")
        idx = presets.index(old_name)
        presets[idx] = new_name
        # 同步更新 locations 表中使用此类型的记录
        locations = await self._load_locations()
        s = self.settings
        for loc in locations.values():
            if loc.type == old_name:
                try:
                    await self.client.update_record(
                        s.bitable_table_locations, loc.id,
                        {s.bitable_f_location_type: new_name},
                    )
                except Exception:
                    pass
        self._locations_cache = None
        self._invalidate_table_cache(s.bitable_table_locations)
        self._save_presets(presets)
        return await self.list_location_types()
