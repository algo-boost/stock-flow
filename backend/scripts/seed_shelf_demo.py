"""为货架格位图写入演示数据：配置库位层列 + 分配库存格位。

用法（需后端已启动，backend 目录）：
    .venv/bin/python scripts/seed_shelf_demo.py

前置（real Bitable 模式）：
    1. python scripts/setup_bitable_inventory_slots.py
    2. python scripts/setup_bitable_location_grid.py
    3. 在 .env 配置对应字段名并重启后端
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx

BASE = "http://127.0.0.1:8000/api"
HEADERS = {"X-Mock-Role": "ADMIN", "X-Mock-User": "seed-demo"}

# 按库位名称匹配： (层数, 列数或 None)
GRID_BY_NAME: dict[str, tuple[int, int | None]] = {
    "电器类A-柜-01": (4, 6),
    "电器类A-架-01": (5, None),
    "机械类B-柜-01": (3, 4),
    "机械类B-架-01": (4, None),
    "其他类D-架-01": (3, None),
    "维修类C-柜-01": (4, 5),
}


async def api_get(client: httpx.AsyncClient, path: str) -> dict:
    resp = await client.get(f"{BASE}{path}", headers=HEADERS)
    resp.raise_for_status()
    body = resp.json()
    if body.get("code") != 0:
        raise RuntimeError(f"GET {path}: {body}")
    return body["data"]


async def api_patch(client: httpx.AsyncClient, path: str, payload: dict) -> dict | None:
    resp = await client.patch(f"{BASE}{path}", headers=HEADERS, json=payload)
    body = resp.json()
    if resp.status_code >= 400 or body.get("code") != 0:
        return None
    return body["data"]


async def main() -> None:
    async with httpx.AsyncClient(timeout=60) as client:
        try:
            await client.get(f"{BASE}/health", headers=HEADERS)
        except httpx.ConnectError:
            print("无法连接后端，请先启动: uvicorn app.main:app --reload --port 8000")
            return

        locations = await api_get(client, "/locations")
        inventory = await api_get(client, "/inventory")

        loc_by_name = {loc["name"]: loc for loc in locations}
        updated_locs = 0
        for name, (rows, cols) in GRID_BY_NAME.items():
            loc = loc_by_name.get(name)
            if not loc:
                print(f"跳过：未找到库位「{name}」")
                continue
            payload: dict = {"grid_rows": rows}
            if cols is not None:
                payload["grid_columns"] = cols
            await api_patch(client, f"/locations/{loc['id']}", payload)
            print(f"已配置 {name}: {rows} 层" + (f" × {cols} 列" if cols else ""))
            updated_locs += 1

        slot_count = 0
        for name, (rows, cols) in GRID_BY_NAME.items():
            loc = loc_by_name.get(name)
            if not loc:
                continue
            loc_id = loc["id"]
            items = [i for i in inventory if i["location_id"] == loc_id and i["quantity"] > 0]
            if not items:
                continue

            for idx, item in enumerate(items):
                if item.get("row") is not None:
                    continue
                if cols is not None:
                    row = (idx // cols) + 1
                    column = (idx % cols) + 1
                else:
                    row = min(idx + 1, rows)
                    column = None

                slot_payload: dict = {"row": row}
                if column is not None:
                    slot_payload["column"] = column

                result = await api_patch(
                    client,
                    f"/materials/{item['material_id']}/inventory/{loc_id}/slot",
                    slot_payload,
                )
                if result:
                    slot_count += 1
                    label = f"{row}-{column}" if column else f"第{row}层"
                    print(f"  分配 {name} / {item['material_id']} → {label}")
                elif slot_count == 0 and idx == 0:
                    print("  格位分配跳过（库存记录未找到或未启用行列字段）")
                    break

        print(f"\n完成：更新 {updated_locs} 个库位，分配 {slot_count} 条库存格位。")
        if slot_count == 0:
            print("提示：前端仍会用「预览分布」展示未指定格位的库存；配置 Bitable 行列字段后可写入真实格位。")


if __name__ == "__main__":
    asyncio.run(main())
