"""清空 Bitable 测试业务数据（保留分类、库位及表结构）。

删除顺序：stock_requests → transactions → inventory → materials

用法（backend 目录）：
    .\\.venv\\Scripts\\python.exe scripts/clear_test_data.py          # 预览
    .\\.venv\\Scripts\\python.exe scripts/clear_test_data.py --yes     # 执行删除
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.bitable.client import BYTableClient
from app.config import Settings, get_settings

DELETE_ORDER: list[tuple[str, str]] = [
    ("stock_requests", "申请"),
    ("transactions", "流水"),
    ("inventory", "库存"),
    ("materials", "物料"),
]


def _table_id(settings: Settings, key: str) -> str:
    mapping = {
        "stock_requests": settings.bitable_table_requests,
        "transactions": settings.bitable_table_transactions,
        "inventory": settings.bitable_table_inventory,
        "materials": settings.bitable_table_materials,
    }
    return mapping[key]


async def _batch_delete(client: BYTableClient, table_id: str, record_ids: list[str]) -> None:
    if not record_ids:
        return
    token = await client._tenant_token()
    url = (
        f"https://open.feishu.cn/open-apis/bitable/v1/apps/"
        f"{client.settings.bitable_app_token}/tables/{table_id}/records/batch_delete"
    )
    chunk_size = 500
    for i in range(0, len(record_ids), chunk_size):
        chunk = record_ids[i : i + chunk_size]
        resp = await client._request(
            "POST",
            url,
            token=token,
            json={"records": chunk},
            action=f"批量删除表 {table_id} 失败",
        )
        client._parse_response(resp, f"批量删除表 {table_id} 失败")


async def main() -> None:
    parser = argparse.ArgumentParser(description="清空 Bitable 测试业务数据")
    parser.add_argument("--yes", action="store_true", help="确认执行删除（默认仅预览）")
    args = parser.parse_args()

    settings = get_settings()
    if settings.bitable_mode != "real":
        print("BITABLE_MODE 不是 real，本脚本仅用于 real Bitable。")
        sys.exit(1)
    if not settings.bitable_configured:
        print("Bitable 未完整配置，请检查 .env。")
        sys.exit(1)

    client = BYTableClient(settings)
    summary: list[tuple[str, int]] = []

    for key, label in DELETE_ORDER:
        table_id = _table_id(settings, key)
        if not table_id:
            print(f"跳过 {label}：未配置表 ID（{key}）")
            summary.append((label, 0))
            continue
        records = await client.list_records(table_id)
        ids = [r["record_id"] for r in records if r.get("record_id")]
        summary.append((label, len(ids)))
        print(f"{label}（{key}）: {len(ids)} 条")

    total = sum(count for _, count in summary)
    print(f"\n合计将删除 {total} 条（不含分类、库位）。")

    if not args.yes:
        print("\n预览模式，未删除。确认后请加 --yes 执行。")
        return

    if total == 0:
        print("没有可删除的数据。")
        return

    print("\n开始删除…")
    for key, label in DELETE_ORDER:
        table_id = _table_id(settings, key)
        if not table_id:
            continue
        records = await client.list_records(table_id)
        ids = [r["record_id"] for r in records if r.get("record_id")]
        if not ids:
            continue
        await _batch_delete(client, table_id, ids)
        print(f"已删除 {label}: {len(ids)} 条")

    print("\n完成。分类与库位未改动；请重启后端或刷新 H5 缓存后再录入新数据。")


if __name__ == "__main__":
    asyncio.run(main())
