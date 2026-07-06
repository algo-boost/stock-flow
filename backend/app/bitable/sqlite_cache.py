"""
SQLite 主存储 — 业务读写优先落本地，飞书 Bitable 通过 outbox 异步同步。

real + sqlite_first 模式下：
  写：SQLite（pending）→ outbox → 后台推 Bitable
  读：仅 SQLite（空表时只读拉取 Bitable 做初始化，不覆盖已有行）
"""

from __future__ import annotations

import json
import logging
import sqlite3
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any

logger = logging.getLogger("stock-flow.sqlite_cache")

DB_PATH = Path(__file__).parent.parent.parent / "data" / "stock_flow_cache.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS records (
    table_id TEXT NOT NULL,
    record_id TEXT NOT NULL,
    fields_json TEXT NOT NULL DEFAULT '{}',
    created_time TEXT,
    last_modified_time TEXT,
    cached_at REAL NOT NULL,
    sync_status TEXT NOT NULL DEFAULT 'synced',
    PRIMARY KEY (table_id, record_id)
);

CREATE INDEX IF NOT EXISTS idx_records_table ON records(table_id);
CREATE INDEX IF NOT EXISTS idx_records_cached ON records(cached_at);
CREATE INDEX IF NOT EXISTS idx_records_created ON records(table_id, created_time DESC);
CREATE INDEX IF NOT EXISTS idx_records_material ON records(table_id, json_extract(fields_json, '$.material_id'));

CREATE TABLE IF NOT EXISTS archived_records (
    table_id TEXT NOT NULL,
    record_id TEXT NOT NULL,
    fields_json TEXT NOT NULL DEFAULT '{}',
    created_time TEXT,
    last_modified_time TEXT,
    cached_at REAL NOT NULL,
    archived_at REAL NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (table_id, record_id)
);
CREATE INDEX IF NOT EXISTS idx_archived_created ON archived_records(table_id, created_time DESC);

CREATE TABLE IF NOT EXISTS sync_outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    table_id TEXT NOT NULL,
    record_id TEXT NOT NULL,
    operation TEXT NOT NULL,
    fields_json TEXT,
    created_at REAL NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    status TEXT NOT NULL DEFAULT 'pending'
);
CREATE INDEX IF NOT EXISTS idx_outbox_status ON sync_outbox(status, created_at);

CREATE TABLE IF NOT EXISTS id_mapping (
    local_id TEXT PRIMARY KEY,
    bitable_id TEXT NOT NULL,
    table_id TEXT NOT NULL
);
"""


class SqliteCache:
    """线程安全的 SQLite 主存储。"""

    def __init__(self, db_path: str | None = None) -> None:
        self._path = Path(db_path or DB_PATH)
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._local = threading.local()
        self._lock = threading.Lock()

    @contextmanager
    def _conn(self):
        if not hasattr(self._local, "conn") or self._local.conn is None:
            self._local.conn = sqlite3.connect(str(self._path), check_same_thread=False)
            self._local.conn.row_factory = sqlite3.Row
            self._local.conn.execute("PRAGMA journal_mode=WAL")
            self._local.conn.execute("PRAGMA synchronous=NORMAL")
            self._local.conn.execute("PRAGMA cache_size=-8000")
        try:
            self._local.conn.executescript(SCHEMA)
            self._migrate_columns(self._local.conn)
            yield self._local.conn
        except Exception:
            self._local.conn.rollback()
            raise

    @staticmethod
    def _migrate_columns(conn: sqlite3.Connection) -> None:
        cols = {row[1] for row in conn.execute("PRAGMA table_info(records)").fetchall()}
        if "sync_status" not in cols:
            conn.execute("ALTER TABLE records ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'synced'")
            conn.commit()
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_records_sync ON records(table_id, sync_status)"
        )
        conn.commit()

    def _row_to_record(self, row: sqlite3.Row) -> dict[str, Any]:
        try:
            fields = json.loads(row["fields_json"])
        except (json.JSONDecodeError, TypeError):
            fields = {}
        return {
            "record_id": row["record_id"],
            "fields": fields,
            "created_time": row["created_time"],
            "last_modified_time": row["last_modified_time"],
            "sync_status": row["sync_status"] if "sync_status" in row.keys() else "synced",
        }

    # ── 读取 ──

    def get_records(self, table_id: str) -> list[dict[str, Any]]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT record_id, fields_json, created_time, last_modified_time, sync_status "
                "FROM records WHERE table_id = ?",
                (table_id,),
            ).fetchall()
        return [self._row_to_record(row) for row in rows]

    def get_record(self, table_id: str, record_id: str) -> dict[str, Any] | None:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT record_id, fields_json, created_time, last_modified_time, sync_status "
                "FROM records WHERE table_id = ? AND record_id = ?",
                (table_id, record_id),
            ).fetchone()
        return self._row_to_record(row) if row else None

    def get_sync_status(self, table_id: str, record_id: str) -> str:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT sync_status FROM records WHERE table_id = ? AND record_id = ?",
                (table_id, record_id),
            ).fetchone()
        if not row:
            return "local_only"
        return row["sync_status"] or "synced"

    # ── 写入 ──

    def upsert_records(self, table_id: str, records: list[dict[str, Any]], *, sync_status: str = "synced") -> None:
        """全表替换（仅用于显式全量导入/重置）。"""
        now = time.monotonic()
        with self._conn() as conn:
            conn.execute("DELETE FROM records WHERE table_id = ?", (table_id,))
            data = [
                (
                    table_id,
                    r.get("record_id", ""),
                    json.dumps(r.get("fields", {}), ensure_ascii=False),
                    r.get("created_time"),
                    r.get("last_modified_time"),
                    now,
                    sync_status,
                )
                for r in records
            ]
            conn.executemany(
                "INSERT OR REPLACE INTO records "
                "(table_id, record_id, fields_json, created_time, last_modified_time, cached_at, sync_status) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                data,
            )
            conn.commit()

    def import_synced_batch(self, table_id: str, records: list[dict[str, Any]]) -> None:
        """合并导入 Bitable 快照：不删表、不覆盖 pending 行、标记 synced。"""
        now = time.monotonic()
        with self._conn() as conn:
            for rec in records:
                rid = rec.get("record_id", "")
                if not rid:
                    continue
                existing = conn.execute(
                    "SELECT sync_status FROM records WHERE table_id = ? AND record_id = ?",
                    (table_id, rid),
                ).fetchone()
                if existing and existing["sync_status"] == "pending":
                    continue
                conn.execute(
                    "INSERT OR REPLACE INTO records "
                    "(table_id, record_id, fields_json, created_time, last_modified_time, cached_at, sync_status) "
                    "VALUES (?, ?, ?, ?, ?, ?, 'synced')",
                    (
                        table_id,
                        rid,
                        json.dumps(rec.get("fields", {}), ensure_ascii=False),
                        rec.get("created_time"),
                        rec.get("last_modified_time"),
                        now,
                    ),
                )
            conn.commit()

    def upsert_one(self, table_id: str, record: dict[str, Any], *, sync_status: str | None = None) -> None:
        now = time.monotonic()
        rid = record.get("record_id", "")
        status = sync_status or record.get("sync_status") or "synced"
        fields = json.dumps(record.get("fields", {}), ensure_ascii=False)
        with self._conn() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO records "
                "(table_id, record_id, fields_json, created_time, last_modified_time, cached_at, sync_status) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    table_id,
                    rid,
                    fields,
                    record.get("created_time"),
                    record.get("last_modified_time"),
                    now,
                    status,
                ),
            )
            conn.commit()

    def set_sync_status(self, table_id: str, record_id: str, status: str) -> None:
        with self._conn() as conn:
            conn.execute(
                "UPDATE records SET sync_status = ? WHERE table_id = ? AND record_id = ?",
                (status, table_id, record_id),
            )
            conn.commit()

    def delete_one(self, table_id: str, record_id: str) -> None:
        with self._conn() as conn:
            conn.execute("DELETE FROM records WHERE table_id = ? AND record_id = ?", (table_id, record_id))
            conn.commit()

    def clear_table(self, table_id: str) -> None:
        with self._conn() as conn:
            conn.execute("DELETE FROM records WHERE table_id = ?", (table_id,))
            conn.commit()

    def remap_record_id(self, table_id: str, old_id: str, new_id: str) -> None:
        """本地临时 ID 同步到 Bitable 后，更新主键并修正全库关联。"""
        with self._conn() as conn:
            row = conn.execute(
                "SELECT fields_json, created_time, last_modified_time, sync_status FROM records "
                "WHERE table_id = ? AND record_id = ?",
                (table_id, old_id),
            ).fetchone()
            if not row:
                return
            conn.execute("DELETE FROM records WHERE table_id = ? AND record_id = ?", (table_id, old_id))
            conn.execute(
                "INSERT OR REPLACE INTO records "
                "(table_id, record_id, fields_json, created_time, last_modified_time, cached_at, sync_status) "
                "VALUES (?, ?, ?, ?, ?, ?, 'synced')",
                (table_id, new_id, row["fields_json"], row["created_time"], row["last_modified_time"], time.monotonic()),
            )
            conn.execute(
                "INSERT OR REPLACE INTO id_mapping (local_id, bitable_id, table_id) VALUES (?, ?, ?)",
                (old_id, new_id, table_id),
            )
            all_rows = conn.execute("SELECT table_id, record_id, fields_json FROM records").fetchall()
            for item in all_rows:
                if old_id not in item["fields_json"]:
                    continue
                new_fields = item["fields_json"].replace(old_id, new_id)
                conn.execute(
                    "UPDATE records SET fields_json = ? WHERE table_id = ? AND record_id = ?",
                    (new_fields, item["table_id"], item["record_id"]),
                )
            conn.execute(
                "UPDATE sync_outbox SET record_id = ? WHERE record_id = ?",
                (new_id, old_id),
            )
            conn.commit()

    def list_id_mappings(self) -> dict[str, str]:
        with self._conn() as conn:
            rows = conn.execute("SELECT local_id, bitable_id FROM id_mapping").fetchall()
        return {row["local_id"]: row["bitable_id"] for row in rows}

    # ── Outbox ──

    def enqueue_outbox(
        self,
        operation: str,
        table_id: str,
        record_id: str,
        fields: dict[str, Any] | None,
    ) -> None:
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO sync_outbox (table_id, record_id, operation, fields_json, created_at, status) "
                "VALUES (?, ?, ?, ?, ?, 'pending')",
                (
                    table_id,
                    record_id,
                    operation,
                    json.dumps(fields, ensure_ascii=False) if fields is not None else None,
                    time.monotonic(),
                ),
            )
            conn.commit()

    def claim_outbox(self, *, limit: int = 50) -> list[dict[str, Any]]:
        with self._lock:
            with self._conn() as conn:
                rows = conn.execute(
                    "SELECT id, table_id, record_id, operation, fields_json, attempts "
                    "FROM sync_outbox WHERE status IN ('pending', 'failed') "
                    "ORDER BY created_at ASC LIMIT ?",
                    (limit,),
                ).fetchall()
                ids = [row["id"] for row in rows]
                if ids:
                    placeholders = ",".join("?" for _ in ids)
                    conn.execute(
                        f"UPDATE sync_outbox SET status = 'processing' WHERE id IN ({placeholders})",
                        ids,
                    )
                    conn.commit()
        return [dict(row) for row in rows]

    def complete_outbox(self, outbox_id: int) -> None:
        with self._conn() as conn:
            conn.execute("DELETE FROM sync_outbox WHERE id = ?", (outbox_id,))
            conn.commit()

    def fail_outbox(self, outbox_id: int, error: str) -> None:
        with self._conn() as conn:
            conn.execute(
                "UPDATE sync_outbox SET status = 'failed', attempts = attempts + 1, last_error = ? WHERE id = ?",
                (error[:500], outbox_id),
            )
            conn.commit()

    def outbox_pending_count(self) -> int:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT COUNT(*) as cnt FROM sync_outbox WHERE status IN ('pending', 'failed', 'processing')"
            ).fetchone()
        return int(row["cnt"]) if row else 0

    def outbox_failed_count(self) -> int:
        with self._conn() as conn:
            row = conn.execute("SELECT COUNT(*) as cnt FROM sync_outbox WHERE status = 'failed'").fetchone()
        return int(row["cnt"]) if row else 0

    def reset_outbox_failed(self) -> int:
        """将 failed/processing 出站任务重置为 pending，便于修复同步逻辑后重试。"""
        with self._conn() as conn:
            cur = conn.execute(
                "UPDATE sync_outbox SET status = 'pending', attempts = 0, last_error = NULL "
                "WHERE status IN ('failed', 'processing')"
            )
            conn.commit()
            return cur.rowcount

    def count_by_sync_status(self, status: str) -> int:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT COUNT(*) as cnt FROM records WHERE sync_status = ?", (status,)
            ).fetchone()
        return int(row["cnt"]) if row else 0

    # ── 分页查询 ──

    def query_records(
        self, table_id: str, *, limit: int = 50, offset: int = 0,
        order_desc: bool = True, material_id: str | None = None,
    ) -> tuple[list[dict[str, Any]], int]:
        with self._conn() as conn:
            where = "WHERE table_id = ?"
            params: list[Any] = [table_id]
            if material_id:
                where += " AND json_extract(fields_json, '$.material_id') = ?"
                params.append(material_id)
            total = conn.execute(f"SELECT COUNT(*) as cnt FROM records {where}", params).fetchone()["cnt"]
            order = "ORDER BY created_time DESC" if order_desc else "ORDER BY created_time ASC"
            rows = conn.execute(
                f"SELECT record_id, fields_json, created_time, last_modified_time, sync_status "
                f"FROM records {where} {order} LIMIT ? OFFSET ?",
                params + [limit, offset],
            ).fetchall()
        return [self._row_to_record(row) for row in rows], total

    # ── 归档 ──

    def archive_before(self, table_id: str, before_days: int) -> int:
        cutoff = time.time() - before_days * 86400
        with self._conn() as conn:
            conn.execute(
                "INSERT OR IGNORE INTO archived_records (table_id, record_id, fields_json, created_time, last_modified_time, cached_at)"
                " SELECT table_id, record_id, fields_json, created_time, last_modified_time, cached_at FROM records"
                " WHERE table_id = ? AND cached_at < ?",
                (table_id, cutoff),
            )
            count = conn.total_changes
            conn.execute("DELETE FROM records WHERE table_id = ? AND cached_at < ?", (table_id, cutoff))
            conn.commit()
        if count:
            logger.info("归档 %s: %d 条移到 archived_records", table_id, count)
        return count

    def archive_stats(self, table_id: str) -> dict[str, int]:
        with self._conn() as conn:
            active = conn.execute("SELECT COUNT(*) as cnt FROM records WHERE table_id = ?", (table_id,)).fetchone()["cnt"]
            archived = conn.execute(
                "SELECT COUNT(*) as cnt FROM archived_records WHERE table_id = ?", (table_id,)
            ).fetchone()["cnt"]
        return {"active": active, "archived": archived}

    # ── 状态 ──

    def table_count(self, table_id: str) -> int:
        with self._conn() as conn:
            row = conn.execute("SELECT COUNT(*) as cnt FROM records WHERE table_id = ?", (table_id,)).fetchone()
        return row["cnt"] if row else 0

    def get_cache_age(self, table_id: str) -> float | None:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT MAX(cached_at) as max_cached FROM records WHERE table_id = ?", (table_id,)
            ).fetchone()
        return row["max_cached"] if row and row["max_cached"] else None

    def snapshot(self) -> dict[str, int]:
        with self._conn() as conn:
            rows = conn.execute("SELECT table_id, COUNT(*) as cnt FROM records GROUP BY table_id").fetchall()
        return {row["table_id"]: row["cnt"] for row in rows}

    def close(self) -> None:
        if hasattr(self._local, "conn") and self._local.conn:
            self._local.conn.close()
            self._local.conn = None


_cache_instance: SqliteCache | None = None


def get_sqlite_cache() -> SqliteCache:
    global _cache_instance
    if _cache_instance is None:
        _cache_instance = SqliteCache()
    return _cache_instance
