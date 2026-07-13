"""
修复因 sync_status 过早置为 synced 导致被 Bitable 旧数据覆盖的审批记录。

逻辑：
  如果一个申请的状态是"待审批"，但它的「流水ID」指向一条实际存在的流水记录，
  说明该申请已被审批通过（流水已生成），只是状态被错误覆盖了。
  此时将该申请的状态修复为"已通过"。

用法：
  cd ~/stock-flow/backend
  python ../scripts/repair_approval_status.py [--dry-run]
"""

from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / "backend" / "data" / "stock_flow_cache.db"


def load_env_table_ids() -> dict[str, str]:
    """从 .env 读取 table_id 映射。"""
    env_path = Path(__file__).parent.parent / "backend" / ".env"
    ids: dict[str, str] = {}
    if not env_path.exists():
        print("[WARN] 找不到 .env 文件，将使用默认 table_id 前缀匹配")
        return ids
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip().strip('"').strip("'")
        if key.startswith("BITABLE_TABLE_"):
            ids[key] = val
    return ids


def get_table_id(env_ids: dict[str, str], key: str, fallback: str) -> str:
    return env_ids.get(key) or fallback


def main(dry_run: bool = False) -> None:
    if not DB_PATH.exists():
        print(f"[ERROR] SQLite 数据库不存在: {DB_PATH}")
        sys.exit(1)

    env_ids = load_env_table_ids()
    requests_table = get_table_id(env_ids, "BITABLE_TABLE_REQUESTS", "tblyQjq19nyIELMQ")
    transactions_table = get_table_id(env_ids, "BITABLE_TABLE_TRANSACTIONS", "tblmilgyAxZOUX4T")

    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row

    # 1. 查所有"待审批"的申请
    pending_requests = conn.execute(
        """SELECT record_id, fields_json, sync_status
           FROM records
           WHERE table_id = ?
             AND json_extract(fields_json, '$.审批状态') IN ('待审批', '')
          """,
        (requests_table,),
    ).fetchall()

    if not pending_requests:
        print("✅ 没有发现待修复的审批记录")
        conn.close()
        return

    print(f"🔍 发现 {len(pending_requests)} 条待审批的申请，正在检查...\n")

    # 2. 预加载所有流水 ID
    tx_ids_result = conn.execute(
        "SELECT record_id FROM records WHERE table_id = ?",
        (transactions_table,),
    ).fetchall()
    tx_ids = {row["record_id"] for row in tx_ids_result}

    # 3. 逐条检查
    to_fix: list[dict] = []
    skip_no_tx: list[str] = []
    skip_no_match: list[str] = []

    for req in pending_requests:
        try:
            fields = json.loads(req["fields_json"])
        except (json.JSONDecodeError, TypeError):
            fields = {}

        tx_id_raw = fields.get("流水ID") or fields.get("transaction_id") or ""
        if not tx_id_raw or tx_id_raw.strip() == "":
            skip_no_tx.append(req["record_id"][:12])
            continue

        # 飞书关联字段可能是 {"id": "xxx"} 格式
        if isinstance(tx_id_raw, dict):
            tx_id_clean = tx_id_raw.get("id", "")
        elif isinstance(tx_id_raw, list) and len(tx_id_raw) > 0:
            first = tx_id_raw[0]
            tx_id_clean = first.get("id", "") if isinstance(first, dict) else str(first)
        else:
            tx_id_clean = str(tx_id_raw).strip()

        if tx_id_clean in tx_ids:
            to_fix.append({
                "record_id": req["record_id"],
                "tx_id": tx_id_clean,
                "sync_status": req["sync_status"],
                "fields": fields,
            })
        else:
            skip_no_match.append(f"{req['record_id'][:12]} → {tx_id_clean[:12]}")

    # 4. 输出结果
    print(f"  ✅ 可修复（有对应流水）: {len(to_fix)} 条")
    print(f"  ⏭️ 跳过（无流水ID）:    {len(skip_no_tx)} 条")
    print(f"  ⏭️ 跳过（流水ID不匹配）: {len(skip_no_match)} 条")
    print()

    if not to_fix:
        print("无需修复。")
        conn.close()
        return

    # 5. 打印预览
    for item in to_fix:
        f = item["fields"]
        material = f.get("物料ID", "")
        if isinstance(material, dict):
            material = material.get("id", material)
        if isinstance(material, list) and material:
            material = material[0] if isinstance(material[0], str) else material[0].get("id", "")
        print(f"  📋 {item['record_id'][:16]}... | 物料={str(material)[:20]} | "
              f"流水={item['tx_id'][:12]}... → 修复为「已通过」")

    if dry_run:
        print(f"\n[DRY RUN] 以上 {len(to_fix)} 条将被修复。去掉 --dry-run 参数以实际执行。")
        conn.close()
        return

    # 6. 执行修复
    confirm = input(f"\n⚠️  确认修复以上 {len(to_fix)} 条记录？[y/N] ")
    if confirm.lower() != "y":
        print("已取消。")
        conn.close()
        return

    fixed = 0
    for item in to_fix:
        f = item["fields"]
        f["审批状态"] = "已通过"
        new_json = json.dumps(f, ensure_ascii=False)
        conn.execute(
            "UPDATE records SET fields_json = ?, sync_status = 'pending' WHERE table_id = ? AND record_id = ?",
            (new_json, requests_table, item["record_id"]),
        )
        # 入队 outbox，推送到飞书
        conn.execute(
            "INSERT INTO sync_outbox (table_id, record_id, operation, fields_json, created_at, status) "
            "VALUES (?, ?, 'update', ?, julianday('now'), 'pending')",
            (requests_table, item["record_id"], json.dumps({"审批状态": "已通过"}, ensure_ascii=False)),
        )
        fixed += 1

    conn.commit()
    conn.close()
    print(f"\n✅ 已修复 {fixed} 条记录。状态已更新为「已通过」并加入出站同步队列。")
    print("   重启后端后，outbox 将自动推送到飞书 Bitable。")


if __name__ == "__main__":
    dry = "--dry-run" in sys.argv
    main(dry_run=dry)
