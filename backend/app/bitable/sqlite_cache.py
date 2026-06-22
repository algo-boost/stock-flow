"""
SQLite 本地缓存 — 镜像多维表格数据，毫秒级读取。
写操作同时更新 Bitable + SQLite；后台定期全量同步。
"""

from __future__ import annotations

import asyncio
import json
import logging
import sqlite3
import threading
import time
from contextlib import contextmanager
from datetime import datetime, timezone
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
    PRIMARY KEY (table_id, record_id)
);

CREATE INDEX IF NOT EXISTS idx_records_table ON records(table_id);
CREATE INDEX IF NOT EXISTS idx_records_cached ON records(cached_at);
"""


class SqliteCache:
    """线程安全的 SQLite 缓存管理器。"""

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
            yield self._local.conn
        except Exception:
            self._local.conn.rollback()
            raise

    # ── 读取 ──

    def get_records(self, table_id: str) -> list[dict[str, Any]]:
        """获取某表所有缓存记录，返回 Bitable 兼容格式。"""
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT record_id, fields_json, created_time, last_modified_time FROM records WHERE table_id = ?",
                (table_id,),
            ).fetchall()
        results: list[dict[str, Any]] = []
        for row in rows:
            try:
                fields = json.loads(row["fields_json"])
            except (json.JSONDecodeError, TypeError):
                fields = {}
            results.append({
                "record_id": row["record_id"],
                "fields": fields,
                "created_time": row["created_time"],
                "last_modified_time": row["last_modified_time"],
            })
        return results

    def get_record(self, table_id: str, record_id: str) -> dict[str, Any] | None:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT fields_json, created_time, last_modified_time FROM records WHERE table_id = ? AND record_id = ?",
                (table_id, record_id),
            ).fetchone()
        if not row:
            return None
        try:
            fields = json.loads(row["fields_json"])
        except (json.JSONDecodeError, TypeError):
            fields = {}
        return {
            "record_id": record_id,
            "fields": fields,
            "created_time": row["created_time"],
            "last_modified_time": row["last_modified_time"],
        }

    # ── 写入 ──

    def upsert_records(self, table_id: str, records: list[dict[str, Any]]) -> None:
        """批量写入或更新记录。"""
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
                )
                for r in records
            ]
            conn.executemany(
                "INSERT OR REPLACE INTO records (table_id, record_id, fields_json, created_time, last_modified_time, cached_at) VALUES (?, ?, ?, ?, ?, ?)",
                data,
            )
            conn.commit()
        logger.debug("SQLite 缓存写入 %s: %d 条", table_id, len(records))

    def upsert_one(self, table_id: str, record: dict[str, Any]) -> None:
        """单条写入或更新（写操作同步）."""
        now = time.monotonic()
        rid = record.get("record_id", "")
        fields = json.dumps(record.get("fields", {}), ensure_ascii=False)
        with self._conn() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO records (table_id, record_id, fields_json, created_time, last_modified_time, cached_at) VALUES (?, ?, ?, ?, ?, ?)",
                (table_id, rid, fields, record.get("created_time"), record.get("last_modified_time"), now),
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

    # ── 状态 ──

    def table_count(self, table_id: str) -> int:
        with self._conn() as conn:
            row = conn.execute("SELECT COUNT(*) as cnt FROM records WHERE table_id = ?", (table_id,)).fetchone()
        return row["cnt"] if row else 0

    def get_cache_age(self, table_id: str) -> float | None:
        """返回最新缓存时间戳（monotonic），无数据返回 None。"""
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


# 全局单例
_cache_instance: SqliteCache | None = None


def get_sqlite_cache() -> SqliteCache:
    global _cache_instance
    if _cache_instance is None:
        _cache_instance = SqliteCache()
    return _cache_instance
