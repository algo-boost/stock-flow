"""测试库存出库修复：模拟 SQLite 数据并验证写入/读取一致性。"""
import sys, os, json, asyncio, tempfile, shutil, time, logging
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

from app.config import Settings
from app.bitable.sqlite_cache import SqliteCache
from app.bitable.fields import field_link_id, field_number

logging.basicConfig(level=logging.INFO, format="%(name)s %(levelname)s %(message)s")

# ── 临时数据库 ──
tmp_dir = tempfile.mkdtemp(prefix="stockflow_test_")
tmp_db = Path(tmp_dir) / "test_cache.db"
print(f"📁 测试数据库: {tmp_db}")

import app.bitable.sqlite_cache as sc
sc.DB_PATH = tmp_db

# 确保加载 backend/.env
os.chdir(str(Path(__file__).parent.parent / "backend"))
settings = Settings()
os.chdir(str(Path(__file__).parent.parent))  # 切回
cache = SqliteCache(str(tmp_db))
sc._instance = cache

# ── 参数 ──
mat, loc, row, col = "mat_test_001", "loc_test_001", 3, 2
init_qty, out_qty = 8, 1

async def run():
    inv_tbl = settings.bitable_table_inventory
    rid = "rec_test_outbound_fix"
    
    # 种子: inventory
    seed = {
        settings.bitable_f_inventory_material: [mat],
        settings.bitable_f_inventory_location: [loc],
        settings.bitable_f_inventory_quantity: init_qty,
        settings.bitable_f_inventory_row: row,
        settings.bitable_f_inventory_column: col,
        settings.bitable_f_inventory_updated: 1720000000000,
    }
    cache.upsert_one(inv_tbl, {"record_id": rid, "fields": seed, "created_time": 1720000000000, "last_modified_time": 1720000000000}, sync_status="synced")
    
    # 种子: materials
    mat_tbl = settings.bitable_table_materials
    cache.upsert_one(mat_tbl, {"record_id": mat, "fields": {"物料名称": "测试螺栓", "单位": "个"}, "created_time": 1720000000000, "last_modified_time": 1720000000000}, sync_status="synced")
    
    # 种子: locations
    loc_tbl = settings.bitable_table_locations
    cache.upsert_one(loc_tbl, {"record_id": loc, "fields": {"库位编号": "A-01", "库位名称": "货柜A", "库位类型": "货柜", settings.bitable_f_location_grid_rows: 5, settings.bitable_f_location_grid_columns: 4}, "created_time": 1720000000000, "last_modified_time": 1720000000000}, sync_status="synced")
    
    print("✅ 种子数据写入")

    # 注入内存缓存（跳过飞书）
    from app.bitable.repository import _TABLE_CACHE, BitableRepository
    now = time.monotonic()
    at = settings.bitable_app_token
    _TABLE_CACHE[(at, inv_tbl)] = (now, [{"record_id": rid, "fields": seed, "created_time": 1720000000000, "last_modified_time": 1720000000000}])
    _TABLE_CACHE[(at, mat_tbl)] = (now, [{"record_id": mat, "fields": {"物料名称": "测试螺栓", "单位": "个"}, "created_time": 1720000000000, "last_modified_time": 1720000000000}])
    _TABLE_CACHE[(at, loc_tbl)] = (now, [{"record_id": loc, "fields": {"库位编号": "A-01", "库位名称": "货柜A", "库位类型": "货柜", settings.bitable_f_location_grid_rows: 5, settings.bitable_f_location_grid_columns: 4}, "created_time": 1720000000000, "last_modified_time": 1720000000000}])

    cache.enqueue_outbox = lambda *a, **kw: None
    repo = BitableRepository(settings)

    # ── 步骤1: 初始读 ──
    print("\n📊 读初始库存...")
    inv = await repo._load_inventory_records()
    key = repo._inv_key(mat, loc, row, col)
    assert key in inv, f"key 不存在！"
    cur = field_number(inv[key]["fields"].get(settings.bitable_f_inventory_quantity))
    assert cur == init_qty, f"初始库存错误: {cur}"
    print(f"  ✅ init={cur}")

    # ── 步骤2: 出库 ──
    print(f"\n📤 出库 {out_qty} 件...")
    await repo._write_inventory_quantity(inv, mat, loc, cur - out_qty, int(time.time()*1000), row=row, column=col)

    # ── 步骤3: 重读验证 ──
    print("\n📊 重读验证...")
    inv2 = await repo._load_inventory_records()
    key2 = repo._inv_key(mat, loc, row, col)
    
    if key2 not in inv2:
        print("  ❌ 库存消失！直接看 SQLite:")
        for r in cache.get_records(inv_tbl):
            f = r.get("fields", {})
            print(f"    rid={r['record_id']} mid={field_link_id(f.get(settings.bitable_f_inventory_material))} lid={field_link_id(f.get(settings.bitable_f_inventory_location))} qty={f.get(settings.bitable_f_inventory_quantity)}")
        return False
    
    actual = field_number(inv2[key2]["fields"].get(settings.bitable_f_inventory_quantity))
    expected = init_qty - out_qty
    if actual == expected:
        print(f"  ✅ 库存={actual} (期望 {expected})")
    else:
        print(f"  ❌ 库存={actual} (期望 {expected})")
        return False

    # ── 步骤4: 完整性 ──
    print("\n🔍 字段完整性...")
    rec = cache.get_record(inv_tbl, rid)
    f = rec["fields"]
    mid2, lid2 = field_link_id(f.get(settings.bitable_f_inventory_material)), field_link_id(f.get(settings.bitable_f_inventory_location))
    q2 = f.get(settings.bitable_f_inventory_quantity)
    print(f"  material={mid2} location={lid2} quantity={q2}")
    if not mid2 or not lid2 or q2 is None:
        print(f"  ❌ 字段丢失！")
        return False
    print("  ✅ 完整")

    # ── 步骤5: 连续出库 ──
    print(f"\n📤 再出 2 件...")
    inv3 = await repo._load_inventory_records()
    cur3 = field_number(inv3[key2]["fields"].get(settings.bitable_f_inventory_quantity))
    await repo._write_inventory_quantity(inv3, mat, loc, cur3 - 2, int(time.time()*1000), row=row, column=col)
    inv4 = await repo._load_inventory_records()
    final = field_number(inv4[key2]["fields"].get(settings.bitable_f_inventory_quantity))
    ef = expected - 2
    if final == ef:
        print(f"  ✅ 最终={final}")
    else:
        print(f"  ❌ 最终={final} 期望={ef}")
        return False

    return True

ok = asyncio.run(run())

# 清理
from app.bitable.repository import _TABLE_CACHE
_TABLE_CACHE.clear()
shutil.rmtree(tmp_dir, ignore_errors=True)
print(f"\n🧹 已清理")
print(f"\n{'='*40}")
print(f"{'🎉 全部通过' if ok else '💥 失败'}！")
sys.exit(0 if ok else 1)
