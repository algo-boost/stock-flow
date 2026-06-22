"""将 Bitable categories 表重置为实验室标准两级分类。

用法（backend 目录）：
    .\\.venv\\Scripts\\python.exe scripts/seed_categories.py          # 预览
    .\\.venv\\Scripts\\python.exe scripts/seed_categories.py --yes     # 执行

注意：会删除 categories 表全部现有记录后重建。物料表须为空或已手动改分类。
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.bitable.client import BYTableClient
from app.bitable.fields import write_link
from app.config import get_settings
from app.data.category_taxonomy import LAB_CATEGORY_TAXONOMY


async def _batch_delete(client: BYTableClient, table_id: str, record_ids: list[str]) -> None:
    if not record_ids:
        return
    token = await client._tenant_token()
    url = (
        f"https://open.feishu.cn/open-apis/bitable/v1/apps/"
        f"{client.settings.bitable_app_token}/tables/{table_id}/records/batch_delete"
    )
    for i in range(0, len(record_ids), 500):
        chunk = record_ids[i : i + 500]
        resp = await client._request(
            "POST",
            url,
            token=token,
            json={"records": chunk},
            action=f"批量删除表 {table_id} 失败",
        )
        client._parse_response(resp, f"批量删除表 {table_id} 失败")


async def main() -> None:
    parser = argparse.ArgumentParser(description="重置 Bitable 分类为标准两级结构")
    parser.add_argument("--yes", action="store_true", help="确认执行")
    args = parser.parse_args()

    settings = get_settings()
    if settings.bitable_mode != "real":
        print("BITABLE_MODE 不是 real，本脚本仅用于 real Bitable。")
        sys.exit(1)
    table_id = settings.bitable_table_categories
    if not table_id:
        print("未配置 BITABLE_TABLE_CATEGORIES。")
        sys.exit(1)

    client = BYTableClient(settings)
    existing = await client.list_records(table_id)
    existing_ids = [r["record_id"] for r in existing if r.get("record_id")]

    root_count = len(LAB_CATEGORY_TAXONOMY)
    leaf_count = sum(len(root.children) for root in LAB_CATEGORY_TAXONOMY)
    print(f"当前分类记录: {len(existing_ids)} 条")
    print(f"将重建: {root_count} 个父类 + {leaf_count} 个子类 = {root_count + leaf_count} 条")
    for root in LAB_CATEGORY_TAXONOMY:
        subs = "、".join(leaf.name for leaf in root.children)
        print(f"  {root.name} → {subs}")

    if not args.yes:
        print("\n预览模式。确认后请加 --yes 执行。")
        return

    if existing_ids:
        print(f"\n删除现有 {len(existing_ids)} 条…")
        await _batch_delete(client, table_id, existing_ids)

    s = settings
    created = 0
    print("\n写入新分类…")
    for root in LAB_CATEGORY_TAXONOMY:
        parent_fields = {
            s.bitable_f_category_name: root.name,
            s.bitable_f_category_major: root.name,
            s.bitable_f_category_sub: "",
            s.bitable_f_category_default_location_type: root.default_location_type,
            s.bitable_f_category_examples: root.examples,
        }
        parent_rec = await client.create_record(table_id, parent_fields)
        parent_id = parent_rec.get("record_id", "")
        if not parent_id:
            raise RuntimeError(f"创建父类「{root.name}」失败")
        created += 1

        for leaf in root.children:
            child_fields = {
                s.bitable_f_category_name: leaf.name,
                s.bitable_f_category_major: root.name,
                s.bitable_f_category_sub: leaf.name,
                s.bitable_f_category_parent: write_link(parent_id),
                s.bitable_f_category_default_location_type: leaf.default_location_type,
                s.bitable_f_category_examples: leaf.examples,
            }
            await client.create_record(table_id, child_fields)
            created += 1

    print(f"完成，共写入 {created} 条。请重启后端或刷新 H5 缓存。")


if __name__ == "__main__":
    asyncio.run(main())
