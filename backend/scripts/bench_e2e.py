"""
端到端性能实测 — 使用 FastAPI TestClient 测试各操作耗时 + 冷启动
路由结构（所有 router 前缀 /api）：
  auth_routes: /api/me, /api/auth/..., /api/bootstrap, /api/health
  materials:    /api/search, /api/catalog, /api/categories, /api (物料CRUD), /api/{id}
  inventory:    /api/locations, /api/inventory, /api/inventory/low-stock
  transactions: /api/inbound, /api/outbound, /api/transfer, /api/transactions, /api/requests
  admin:        /api/overview, /api/audit, /api/system, /api/cache/refresh, /api/sqlite-status
"""
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))


def format_ms(seconds: float) -> str:
    if seconds < 0.001:
        return f"{seconds*1_000_000:.0f}μs"
    elif seconds < 1:
        return f"{seconds*1000:.0f}ms"
    else:
        return f"{seconds:.2f}s"


_results: list[tuple[str, float, int, int]] = []


def bench(label: str, fn, *args, **kwargs):
    t0 = time.perf_counter()
    try:
        result = fn(*args, **kwargs)
        elapsed = time.perf_counter() - t0
        status = result.status_code if hasattr(result, "status_code") else 0
        size = len(result.content) if hasattr(result, "content") else 0
        ok = "✅" if status < 400 else "⚠️"
        print(f"  {ok} {label}: {format_ms(elapsed)}  (HTTP {status}, {size}B)")
        _results.append((label, elapsed, status, size))
        return elapsed, result
    except Exception as exc:
        elapsed = time.perf_counter() - t0
        print(f"  ❌ {label}: {format_ms(elapsed)}  {exc}")
        _results.append((label, elapsed, 0, 0))
        return elapsed, None


AUTH_HEADERS = {"X-Mock-Role": "ADMIN", "X-Mock-User": "bench-user"}


def main():
    # ── 强制 real 模式 ──
    os.environ["BITABLE_MODE"] = "real"

    # ── 1. 冷启动 ──
    print("=" * 60)
    print("物料出入库管理系统 — 端到端性能实测 (REAL 模式)")
    print("=" * 60)

    print("\n── 1. 冷启动（应用初始化 + 飞书同步）──")
    for mod in list(sys.modules.keys()):
        if mod.startswith("app."):
            del sys.modules[mod]

    t0 = time.perf_counter()
    from app.main import create_app
    app = create_app()
    cold_start = time.perf_counter() - t0
    print(f"  create_app() 耗时: {format_ms(cold_start)}")

    from fastapi.testclient import TestClient
    with TestClient(app) as client:
        print(f"  认证: mock (X-Mock-Role: ADMIN)")

        # ── 2. 认证 & 引导 ──
        print("\n── 2. 认证 & 引导 ──")
        bench("GET  /api/health", client.get, "/api/health")
        bench("GET  /api/bootstrap", client.get, "/api/bootstrap", headers=AUTH_HEADERS)
        bench("GET  /api/me (需登录)", client.get, "/api/me", headers=AUTH_HEADERS)

        # ── 3. 基础数据 ──
        print("\n── 3. 基础数据 ──")
        bench("GET  /api/materials/categories", client.get, "/api/materials/categories", headers=AUTH_HEADERS)
        bench("GET  /api/materials/catalog", client.get, "/api/materials/catalog", headers=AUTH_HEADERS)
        bench("GET  /api/locations", client.get, "/api/locations")
        bench("GET  /api/materials/catalog (物料列表)", client.get, "/api/materials/catalog", headers=AUTH_HEADERS)

        # ── 4. 搜索 ──
        print("\n── 4. 搜索 ──")
        bench("GET  /api/materials/search?q=螺丝", client.get, "/api/materials/search?q=螺丝", headers=AUTH_HEADERS)
        bench("GET  /api/materials/search?q=螺母&limit=5", client.get, "/api/materials/search?q=螺母&limit=5", headers=AUTH_HEADERS)
        bench("GET  /api/materials/search?q=nonexistent", client.get, "/api/materials/search?q=nonexistent", headers=AUTH_HEADERS)

        # ── 5. 库存 ──
        print("\n── 5. 库存 ──")
        bench("GET  /api/inventory", client.get, "/api/inventory", headers=AUTH_HEADERS)
        bench("GET  /api/inventory/low-stock", client.get, "/api/inventory/low-stock", headers=AUTH_HEADERS)

        # ── 6. 流水翻页 ──
        print("\n── 6. 交易流水 ──")
        bench("GET  /api/transactions?limit=20", client.get, "/api/transactions?limit=20", headers=AUTH_HEADERS)
        bench("GET  /api/transactions?limit=50", client.get, "/api/transactions?limit=50", headers=AUTH_HEADERS)
        bench("GET  /api/transactions?limit=50&offset=50", client.get, "/api/transactions?limit=50&offset=50", headers=AUTH_HEADERS)
        bench("GET  /api/requests/mine?limit=20", client.get, "/api/requests/mine?limit=20", headers=AUTH_HEADERS)

        # ── 7. 物料详情 ──
        print("\n── 7. 物料详情 ──")
        resp = client.get("/api/materials/catalog", headers=AUTH_HEADERS)
        if resp.status_code == 200 and resp.text.strip():
            data = resp.json()
            # catalog 返回格式: {"code":0, "data": [...]}
            items = data if isinstance(data, list) else data.get("data", [])
            if items:
                mat_id = items[0] if isinstance(items[0], str) else items[0].get("record_id") or items[0].get("id", "")
                if mat_id:
                    bench(f"GET  /api/materials/{mat_id}", client.get, f"/api/materials/{mat_id}", headers=AUTH_HEADERS)
                    bench(f"GET  /api/materials/{mat_id}/transactions", client.get, f"/api/materials/{mat_id}/transactions", headers=AUTH_HEADERS)
        else:
            print("  ⚠ 无法获取物料列表，跳过详情测试")

        # ── 8. 管理后台 ──
        print("\n── 8. 管理后台 (需 keeper) ──")
        bench("GET  /api/admin/overview", client.get, "/api/admin/overview", headers=AUTH_HEADERS)
        bench("GET  /api/admin/audit?limit=30", client.get, "/api/admin/audit?limit=30", headers=AUTH_HEADERS)
        bench("GET  /api/requests?limit=30", client.get, "/api/requests?limit=30", headers=AUTH_HEADERS)
        bench("GET  /api/admin/system", client.get, "/api/admin/system", headers=AUTH_HEADERS)

        # ── 9. 写操作 ──
        print("\n── 9. 写操作 ──")
        bench("POST /api/materials (创建物料)",
            client.post, "/api/materials",
            json={"name": "benchmark_测试螺丝", "category_id": "cat_fastener", "unit": "个"},
            headers=AUTH_HEADERS,
        )
        bench("POST /api/inbound (入库)",
            client.post, "/api/inbound",
            json={"material_id": "mat_001", "qty": 10, "location_id": "loc_01", "idempotency_key": "bench-test-00000001"},
            headers=AUTH_HEADERS,
        )

        # ── 10. 运维操作 ──
        print("\n── 10. 运维操作 ──")
        bench("POST /api/admin/cache/refresh", client.post, "/api/admin/cache/refresh", headers=AUTH_HEADERS)
        bench("GET  /api/admin/sqlite-status", client.get, "/api/admin/sqlite-status", headers=AUTH_HEADERS)
        bench("GET  /api/admin/transactions/archive-stats", client.get, "/api/admin/transactions/archive-stats", headers=AUTH_HEADERS)
        bench("POST /api/admin/bulk-sync", client.post, "/api/admin/bulk-sync", json={"dry_run": True}, headers=AUTH_HEADERS)

    # ── 汇总 ──
    print("\n" + "=" * 60)
    ok_count = sum(1 for _, _, s, _ in _results if 0 < s < 400)
    err_count = sum(1 for _, _, s, _ in _results if s >= 400 or s == 0)
    avg_ms = sum(e for _, e, _, _ in _results) / max(len(_results), 1) * 1000
    total_ms = sum(e for _, e, _, _ in _results) * 1000
    print(f"  冷启动:         {format_ms(cold_start)}")
    print(f"  接口数:         {len(_results)} ({ok_count} 成功, {err_count} 异常)")
    print(f"  平均响应:       {avg_ms:.0f}ms")
    print(f"  接口总耗时:     {format_ms(total_ms/1000)}")
    print(f"  端到端总耗时:   {format_ms(cold_start + total_ms/1000)}")
    print(f"  数据模式:       real (含飞书网络延迟)")
    print("=" * 60)


if __name__ == "__main__":
    main()
