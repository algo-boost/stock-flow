"""在 Bitable inventory 表创建「行」「列」数字列，供货柜格位功能使用。

用法（backend 目录）：
    .\\.venv\\Scripts\\python.exe scripts/setup_bitable_inventory_slots.py

创建成功后，在 .env 中配置：
    BITABLE_F_INVENTORY_ROW=行
    BITABLE_F_INVENTORY_COLUMN=列
并重启后端。
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx

from app.bitable.client import BYTableClient
from app.config import get_settings

SLOT_FIELDS = ("行", "列")


async def list_field_names(client: BYTableClient, token: str, table_id: str) -> set[str]:
    s = get_settings()
    url = f"https://open.feishu.cn/open-apis/bitable/v1/apps/{s.bitable_app_token}/tables/{table_id}/fields"
    async with httpx.AsyncClient(trust_env=False, timeout=30) as http:
        resp = await http.get(url, headers={"Authorization": f"Bearer {token}"})
        data = resp.json()
        if data.get("code") != 0:
            raise RuntimeError(f"读取字段失败: {data}")
        return {item.get("field_name", "") for item in data.get("data", {}).get("items", [])}


async def create_number_field(client: BYTableClient, token: str, table_id: str, name: str) -> None:
    s = get_settings()
    url = f"https://open.feishu.cn/open-apis/bitable/v1/apps/{s.bitable_app_token}/tables/{table_id}/fields"
    body = {"field_name": name, "type": 2, "property": {"formatter": "0"}}
    async with httpx.AsyncClient(trust_env=False, timeout=30) as http:
        resp = await http.post(url, headers={"Authorization": f"Bearer {token}"}, json=body)
        data = resp.json()
        if data.get("code") != 0:
            raise RuntimeError(f"创建字段「{name}」失败: {data}")
        field_id = data.get("data", {}).get("field", {}).get("field_id")
        print(f"已创建字段「{name}」 field_id={field_id}")


async def main() -> None:
    settings = get_settings()
    if settings.bitable_mode != "real":
        print("BITABLE_MODE 不是 real，跳过。")
        return
    if not settings.bitable_table_inventory:
        print("未配置 BITABLE_TABLE_INVENTORY。")
        return

    client = BYTableClient(settings)
    token = await client._tenant_token()
    existing = await list_field_names(client, token, settings.bitable_table_inventory)
    for name in SLOT_FIELDS:
        if name in existing:
            print(f"字段「{name}」已存在，跳过。")
            continue
        await create_number_field(client, token, settings.bitable_table_inventory, name)
    print("完成。请在 .env 添加 BITABLE_F_INVENTORY_ROW=行 与 BITABLE_F_INVENTORY_COLUMN=列 后重启后端。")


if __name__ == "__main__":
    asyncio.run(main())
