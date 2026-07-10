"""API 集成测试 - 用正确路由。"""
import httpx, sys, uuid

API = "http://127.0.0.1:8000/api"
AUTH = {"X-Mock-Role": "admin", "X-Mock-User": "test_admin"}

def req(method, path, **kw):
    r = httpx.request(method, f"{API}{path}", headers=AUTH, timeout=30, **kw)
    if r.status_code >= 400:
        print(f"  ❌ {method} {path} -> {r.status_code}: {r.text[:300]}")
        r.raise_for_status()
    return r.json()

print("📡 获取现有数据...")
cats = req("GET", "/materials/categories")
cat_id = cats["data"][0]["id"]
print(f"  分类: {cats['data'][0]['name']} ({cat_id})")

locs = req("GET", "/locations")
loc = next((l for l in locs["data"] if l.get("grid_rows") and l.get("grid_columns")), None)
assert loc, "没有格位库位"
print(f"  库位: {loc['name']} grid={loc['grid_rows']}x{loc['grid_columns']}")

mat_name = f"测试螺栓-{uuid.uuid4().hex[:6]}"
print(f"\n➕ 创建物料: {mat_name}")
r = req("POST", "/materials", json={"name": mat_name, "category_id": cat_id, "unit": "个", "spec": "M8x30", "min_stock": 5})
mat_id = r["data"]["id"]
print(f"  ✅ {mat_id}")

row, col, init_qty = 3, 2, 8
print(f"\n📥 入库 {init_qty} 件 -> 格位({row}行{col}列)")
r = req("POST", "/inbound", json={"material_id": mat_id, "location_id": loc["id"], "qty": init_qty, "row": row, "column": col, "idempotency_key": f"seed_{uuid.uuid4().hex[:16]}"})
print(f"  ✅ tx={r['data']['transaction_id']}")

def check(expected, label):
    inv = req("GET", f"/inventory?material_id={mat_id}&location_id={loc['id']}")
    if not inv["data"]:
        print(f"  ❌ [{label}] 库存消失！0条记录")
        return False
    item = inv["data"][0]
    q = item["quantity"]
    ok = q == expected
    print(f"  {'✅' if ok else '❌'} [{label}] 格位({item.get('row')},{item.get('column')}) 数量={q} (期望{expected})")
    return ok

assert check(init_qty, "入库后")

out = 1
print(f"\n📤 出库 {out} 件...")
r = req("POST", "/outbound", json={"material_id": mat_id, "location_id": loc["id"], "qty": out, "row": row, "column": col, "idempotency_key": f"out_{uuid.uuid4().hex[:16]}", "return_required": False})
print(f"  ✅ tx={r['data']['transaction_id']}")
ok1 = check(init_qty - out, "出1件后")

out2 = 2
print(f"\n📤 再出 {out2} 件...")
r = req("POST", "/outbound", json={"material_id": mat_id, "location_id": loc["id"], "qty": out2, "row": row, "column": col, "idempotency_key": f"out2_{uuid.uuid4().hex[:16]}", "return_required": False})
ok2 = check(init_qty - out - out2, "再出2件后")

print(f"\n{'='*50}")
if ok1 and ok2:
    print("🎉 全部通过！8→出1→7→再出2→5 ✅")
else:
    print("💥 失败！")
    sys.exit(1)
