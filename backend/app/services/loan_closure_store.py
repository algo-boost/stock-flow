from __future__ import annotations

import sqlite3
import threading
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from app.models import DispositionStatus, DispositionType, LoanClosureRequest

DB_PATH = Path(__file__).parent.parent.parent / "data" / "loan_closures.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS loan_closure_requests (
    id TEXT PRIMARY KEY,
    source_tx_id TEXT NOT NULL,
    material_id TEXT NOT NULL,
    material_name TEXT,
    location_id TEXT NOT NULL,
    location_name TEXT,
    quantity INTEGER NOT NULL,
    disposition_type TEXT NOT NULL,
    status TEXT NOT NULL,
    requester_open_id TEXT NOT NULL,
    requester_name TEXT NOT NULL,
    approver_open_id TEXT,
    approver_name TEXT,
    note TEXT,
    reject_reason TEXT,
    disposition_tx_id TEXT,
    created_at REAL NOT NULL,
    reviewed_at REAL
);
CREATE INDEX IF NOT EXISTS idx_closure_status ON loan_closure_requests(status);
CREATE INDEX IF NOT EXISTS idx_closure_source ON loan_closure_requests(source_tx_id);
"""


class LoanClosureStore:
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
        try:
            self._local.conn.executescript(SCHEMA)
            yield self._local.conn
            self._local.conn.commit()
        except Exception:
            self._local.conn.rollback()
            raise

    def _row_to_model(self, row: sqlite3.Row) -> LoanClosureRequest:
        created_at = datetime.fromtimestamp(row["created_at"], tz=timezone.utc)
        reviewed_raw = row["reviewed_at"]
        reviewed_at = (
            datetime.fromtimestamp(reviewed_raw, tz=timezone.utc) if reviewed_raw is not None else None
        )
        return LoanClosureRequest(
            id=row["id"],
            source_tx_id=row["source_tx_id"],
            material_id=row["material_id"],
            material_name=row["material_name"],
            location_id=row["location_id"],
            location_name=row["location_name"],
            quantity=row["quantity"],
            disposition_type=DispositionType(row["disposition_type"]),
            status=DispositionStatus(row["status"]),
            requester_open_id=row["requester_open_id"],
            requester_name=row["requester_name"],
            approver_open_id=row["approver_open_id"],
            approver_name=row["approver_name"],
            note=row["note"],
            reject_reason=row["reject_reason"],
            disposition_tx_id=row["disposition_tx_id"],
            created_at=created_at,
            reviewed_at=reviewed_at,
        )

    def create(
        self,
        *,
        source_tx_id: str,
        material_id: str,
        material_name: str | None,
        location_id: str,
        location_name: str | None,
        quantity: int,
        disposition_type: DispositionType,
        requester_open_id: str,
        requester_name: str,
        note: str | None,
    ) -> LoanClosureRequest:
        with self._lock:
            with self._conn() as conn:
                pending = conn.execute(
                    """
                    SELECT id FROM loan_closure_requests
                    WHERE source_tx_id = ? AND status = ?
                    """,
                    (source_tx_id, DispositionStatus.PENDING.value),
                ).fetchone()
                if pending:
                    raise ValueError("closure_request_exists")
                req_id = f"closure_{uuid.uuid4().hex[:12]}"
                now = time.time()
                conn.execute(
                    """
                    INSERT INTO loan_closure_requests (
                        id, source_tx_id, material_id, material_name, location_id, location_name,
                        quantity, disposition_type, status, requester_open_id, requester_name,
                        note, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        req_id,
                        source_tx_id,
                        material_id,
                        material_name,
                        location_id,
                        location_name,
                        quantity,
                        disposition_type.value,
                        DispositionStatus.PENDING.value,
                        requester_open_id,
                        requester_name,
                        note,
                        now,
                    ),
                )
                row = conn.execute(
                    "SELECT * FROM loan_closure_requests WHERE id = ?", (req_id,)
                ).fetchone()
                return self._row_to_model(row)

    def list(
        self,
        *,
        status: DispositionStatus | None = None,
        requester_open_id: str | None = None,
    ) -> list[LoanClosureRequest]:
        clauses: list[str] = []
        params: list[object] = []
        if status:
            clauses.append("status = ?")
            params.append(status.value)
        if requester_open_id:
            clauses.append("requester_open_id = ?")
            params.append(requester_open_id)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        with self._conn() as conn:
            rows = conn.execute(
                f"SELECT * FROM loan_closure_requests {where} ORDER BY created_at DESC",
                params,
            ).fetchall()
        return [self._row_to_model(row) for row in rows]

    def get(self, request_id: str) -> LoanClosureRequest | None:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM loan_closure_requests WHERE id = ?", (request_id,)
            ).fetchone()
        return self._row_to_model(row) if row else None

    def mark_reviewed(
        self,
        request_id: str,
        *,
        status: DispositionStatus,
        approver_open_id: str,
        approver_name: str,
        disposition_tx_id: str | None = None,
        reject_reason: str | None = None,
    ) -> LoanClosureRequest:
        with self._lock:
            with self._conn() as conn:
                row = conn.execute(
                    "SELECT * FROM loan_closure_requests WHERE id = ?", (request_id,)
                ).fetchone()
                if not row:
                    raise ValueError("closure_request_not_found")
                if row["status"] != DispositionStatus.PENDING.value:
                    raise ValueError("closure_request_already_reviewed")
                now = time.time()
                conn.execute(
                    """
                    UPDATE loan_closure_requests
                    SET status = ?, approver_open_id = ?, approver_name = ?,
                        disposition_tx_id = ?, reject_reason = ?, reviewed_at = ?
                    WHERE id = ?
                    """,
                    (
                        status.value,
                        approver_open_id,
                        approver_name,
                        disposition_tx_id,
                        reject_reason,
                        now,
                        request_id,
                    ),
                )
                updated = conn.execute(
                    "SELECT * FROM loan_closure_requests WHERE id = ?", (request_id,)
                ).fetchone()
                return self._row_to_model(updated)


_store: LoanClosureStore | None = None


def get_loan_closure_store() -> LoanClosureStore:
    global _store
    if _store is None:
        _store = LoanClosureStore()
    return _store
