"""SQLite 主库 → 飞书 Bitable 异步出站同步。

写入顺序：先落 SQLite（pending）→ 入队 outbox → 后台 worker 推送到 Bitable。
已有 Bitable 记录（import/synced）仅在本地显式修改后才 update/delete，不会全量覆盖。
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from typing import Any

from app.bitable.client import BYTableClient
from app.bitable.fields import merge_bitable_field_values, prepare_fields_for_bitable_write
from app.bitable.sqlite_cache import get_sqlite_cache
from app.config import Settings

logger = logging.getLogger("stock-flow.bitable_sync")

_LOCAL_ID_PREFIX = "loc_"


class BitableSyncService:
    def __init__(self, settings: Settings, client: BYTableClient) -> None:
        self.settings = settings
        self.client = client
        self._sqlite = get_sqlite_cache()
        self._lock = asyncio.Lock()
        self._wake = asyncio.Event()

    def request_sync(self) -> None:
        self._wake.set()

    async def create_local(self, table_id: str, fields: dict[str, Any]) -> dict[str, Any]:
        record_id = f"{_LOCAL_ID_PREFIX}{uuid.uuid4().hex[:16]}"
        now_ms = int(time.time() * 1000)
        record = {
            "record_id": record_id,
            "fields": dict(fields),
            "created_time": now_ms,
            "last_modified_time": now_ms,
        }
        self._sqlite.upsert_one(table_id, record, sync_status="pending")
        self._sqlite.enqueue_outbox("create", table_id, record_id, fields)
        self.request_sync()
        return record

    async def update_local(self, table_id: str, record_id: str, fields: dict[str, Any]) -> dict[str, Any]:
        existing = self._sqlite.get_record(table_id, record_id) or {"record_id": record_id, "fields": {}}
        merged_fields = merge_bitable_field_values(existing.get("fields", {}), fields)
        now_ms = int(time.time() * 1000)
        record = {
            "record_id": record_id,
            "fields": merged_fields,
            "created_time": existing.get("created_time") or now_ms,
            "last_modified_time": now_ms,
        }
        status = self._sqlite.get_sync_status(table_id, record_id)
        next_status = "pending" if status != "local_only" else "local_only"
        self._sqlite.upsert_one(table_id, record, sync_status=next_status)
        if status != "local_only":
            self._sqlite.enqueue_outbox("update", table_id, record_id, merged_fields)
            self.request_sync()
        return record

    async def delete_local(self, table_id: str, record_id: str) -> None:
        status = self._sqlite.get_sync_status(table_id, record_id)
        self._sqlite.delete_one(table_id, record_id)
        if status == "synced":
            self._sqlite.enqueue_outbox("delete", table_id, record_id, None)
            self.request_sync()

    async def import_from_bitable(self, table_id: str, records: list[dict[str, Any]]) -> int:
        """只读导入：标记 synced，不入 outbox，不修改 Bitable。"""
        if not records:
            return 0
        self._sqlite.import_synced_batch(table_id, records)
        return len(records)

    async def process_outbox(self, *, limit: int = 50) -> dict[str, int]:
        if self.settings.bitable_mode != "real" or not self.settings.bitable_configured:
            return {"processed": 0, "failed": 0, "pending": 0}
        stats = {"processed": 0, "failed": 0, "pending": 0}
        async with self._lock:
            items = self._sqlite.claim_outbox(limit=limit)
            for item in items:
                try:
                    await self._sync_one(item)
                    self._sqlite.complete_outbox(item["id"])
                    stats["processed"] += 1
                except Exception as exc:
                    logger.warning(
                        "Bitable 同步失败 op=%s table=%s id=%s: %s",
                        item.get("operation"),
                        item.get("table_id"),
                        item.get("record_id"),
                        exc,
                    )
                    self._sqlite.fail_outbox(item["id"], str(exc))
                    stats["failed"] += 1
        stats["pending"] = self._sqlite.outbox_pending_count()
        return stats

    async def run_loop(self, interval_seconds: float) -> None:
        """后台循环：处理 outbox + 等待唤醒。"""
        while True:
            try:
                await self.process_outbox()
            except Exception:
                logger.exception("outbox 处理异常")
            try:
                await asyncio.wait_for(self._wake.wait(), timeout=interval_seconds)
            except asyncio.TimeoutError:
                pass
            self._wake.clear()

    async def _sync_one(self, item: dict[str, Any]) -> None:
        op = item["operation"]
        table_id = item["table_id"]
        record_id = item["record_id"]
        if op == "create":
            await self._sync_create(table_id, record_id, item.get("fields_json"))
        elif op == "update":
            await self._sync_update(table_id, record_id, item.get("fields_json"))
        elif op == "delete":
            await self._sync_delete(table_id, record_id)
        else:
            raise ValueError(f"unknown outbox operation: {op}")

    async def _sync_create(self, table_id: str, record_id: str, fields_json: str | None) -> None:
        row = self._sqlite.get_record(table_id, record_id)
        if not row:
            return
        fields = row.get("fields", {})
        if fields_json:
            try:
                fields = merge_bitable_field_values(fields, json.loads(fields_json))
            except json.JSONDecodeError:
                pass
        fields = prepare_fields_for_bitable_write(self._resolve_link_fields(fields))
        result = await self.client.create_record(table_id, fields)
        bitable_id = result.get("record_id") or record_id
        if bitable_id != record_id:
            self._sqlite.remap_record_id(table_id, record_id, bitable_id)
            record_id = bitable_id
        if result.get("fields"):
            merged = merge_bitable_field_values(result["fields"], fields)
            self._sqlite.upsert_one(
                table_id,
                {
                    "record_id": record_id,
                    "fields": merged,
                    "created_time": result.get("created_time") or row.get("created_time"),
                    "last_modified_time": result.get("last_modified_time") or row.get("last_modified_time"),
                },
                sync_status="synced",
            )
        else:
            self._sqlite.set_sync_status(table_id, record_id, "synced")

    async def _sync_update(self, table_id: str, record_id: str, fields_json: str | None) -> None:
        row = self._sqlite.get_record(table_id, record_id)
        if not row:
            return
        if record_id.startswith(_LOCAL_ID_PREFIX):
            await self._sync_create(table_id, record_id, fields_json)
            return
        delta: dict[str, Any] = {}
        if fields_json:
            try:
                delta = json.loads(fields_json)
            except json.JSONDecodeError:
                pass
        write_fields = prepare_fields_for_bitable_write(self._resolve_link_fields(delta))
        if not write_fields:
            self._sqlite.set_sync_status(table_id, record_id, "synced")
            return
        result = await self.client.update_record(table_id, record_id, write_fields)
        if result.get("fields"):
            # 用本地完整记录兜底，防止 Bitable 返回不完整数据导致关联字段丢失
            safe_base = dict(row.get("fields", {}))
            merged = merge_bitable_field_values(
                merge_bitable_field_values(safe_base, result["fields"]),
                write_fields,
            )
            self._sqlite.upsert_one(
                table_id,
                {
                    "record_id": record_id,
                    "fields": merged,
                    "created_time": row.get("created_time"),
                    "last_modified_time": result.get("last_modified_time") or row.get("last_modified_time"),
                },
                sync_status="synced",
            )
        else:
            self._sqlite.set_sync_status(table_id, record_id, "synced")

    async def _sync_delete(self, table_id: str, record_id: str) -> None:
        if record_id.startswith(_LOCAL_ID_PREFIX):
            return
        await self.client.delete_record(table_id, record_id)

    def _resolve_link_fields(self, fields: dict[str, Any]) -> dict[str, Any]:
        """将 fields 内 loc_ 临时 ID 替换为已同步的 Bitable record_id。"""
        raw = json.dumps(fields, ensure_ascii=False)
        for local_id, bitable_id in self._sqlite.list_id_mappings().items():
            raw = raw.replace(local_id, bitable_id)
        return json.loads(raw)

    def status_snapshot(self) -> dict[str, Any]:
        return {
            "sqlite_first": self.settings.sqlite_first_enabled,
            "outbox_pending": self._sqlite.outbox_pending_count(),
            "outbox_failed": self._sqlite.outbox_failed_count(),
            "records_pending": self._sqlite.count_by_sync_status("pending"),
        }


_sync_service: BitableSyncService | None = None


def get_sync_service(settings: Settings, client: BYTableClient) -> BitableSyncService:
    global _sync_service
    if _sync_service is None:
        _sync_service = BitableSyncService(settings, client)
    return _sync_service
