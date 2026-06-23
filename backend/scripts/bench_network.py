"""
飞书 Bitable API 网络延迟基准测试
测试真实 HTTP 调用耗时：连接、鉴权、分页读表、冷/热启动对比
"""
import asyncio
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from app.bitable.client import BYTableClient
from app.config import Settings


def load_settings() -> Settings | None:
    """从环境变量加载飞书配置。"""
    env_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".env")
    if os.path.exists(env_file):
        with open(env_file, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, _, val = line.partition("=")
                    os.environ.setdefault(key.strip(), val.strip().strip('"').strip("'"))
    settings = Settings()
    # 强制使用 real 模式以测试真实网络延迟
    settings.bitable_mode = "real"
    if not settings.bitable_configured:
        print("❌ 未检测到飞书配置，请检查 .env 文件")
        return None
    return settings


async def bench_api(label: str, coro):
    """执行并计时。"""
    t0 = time.perf_counter()
    try:
        result = await coro
        elapsed = time.perf_counter() - t0
        return elapsed, result, None
    except Exception as exc:
        elapsed = time.perf_counter() - t0
        return elapsed, None, str(exc)


def format_ms(seconds: float) -> str:
    if seconds < 0.001:
        return f"{seconds*1_000_000:.0f}μs"
    elif seconds < 1:
        return f"{seconds*1000:.0f}ms"
    else:
        return f"{seconds:.2f}s"


async def test_tenant_token(client: BYTableClient) -> dict:
    """测试获取 tenant_access_token 延迟（含首次/缓存）。"""
    results = {}

    # 首次获取（无缓存）
    client._cached_token = None
    client._cached_token_expires = 0
    elapsed, _, err = await bench_api("tenant_token (首次)", client._tenant_token())
    results["tenant_token_cold"] = {"elapsed": elapsed, "error": err}

    # 缓存命中
    elapsed, _, err = await bench_api("tenant_token (缓存)", client._tenant_token())
    results["tenant_token_warm"] = {"elapsed": elapsed, "error": err}

    return results


async def test_list_table(client: BYTableClient, table_id: str, name: str) -> dict:
    """测试单表全量读取延迟（含分页耗时）。"""
    if not table_id:
        return {"elapsed": 0, "records": 0, "pages": 0, "error": "table_id 为空"}

    t0 = time.perf_counter()
    try:
        records = await client.list_records(table_id)
        elapsed = time.perf_counter() - t0
        pages = max(1, (len(records) + 499) // 500) if records else 0
        return {"elapsed": elapsed, "records": len(records), "pages": pages, "error": None}
    except Exception as exc:
        elapsed = time.perf_counter() - t0
        return {"elapsed": elapsed, "records": 0, "pages": 0, "error": str(exc)}


async def test_connection_establishment(client: BYTableClient) -> dict:
    """测试 TCP+TLS 握手延迟（通过首次请求 vs 后续请求对比）。"""
    import httpx

    results = {}

    # 新建连接（冷连接）
    t0 = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=15.0) as c:
            resp = await c.get("https://open.feishu.cn", headers={"User-Agent": "bench"})
        elapsed_cold = time.perf_counter() - t0
        results["connect_cold"] = {"elapsed": elapsed_cold, "status": resp.status_code}
    except Exception as exc:
        results["connect_cold"] = {"elapsed": time.perf_counter() - t0, "error": str(exc)}

    # 复用连接池（热连接）
    http = await client._ensure_http()
    t0 = time.perf_counter()
    try:
        resp = await http.get("https://open.feishu.cn", headers={"User-Agent": "bench"})
        elapsed_warm = time.perf_counter() - t0
        results["connect_warm"] = {"elapsed": elapsed_warm, "status": resp.status_code}
    except Exception as exc:
        results["connect_warm"] = {"elapsed": time.perf_counter() - t0, "error": str(exc)}

    # 第二次复用（验证持续复用）
    t0 = time.perf_counter()
    try:
        resp = await http.get("https://open.feishu.cn", headers={"User-Agent": "bench"})
        elapsed_warm2 = time.perf_counter() - t0
        results["connect_warm2"] = {"elapsed": elapsed_warm2, "status": resp.status_code}
    except Exception as exc:
        results["connect_warm2"] = {"elapsed": time.perf_counter() - t0, "error": str(exc)}

    return results


async def test_cold_start_full(client: BYTableClient, core_tables: dict[str, str]) -> dict:
    """模拟完整冷启动：清空 token 缓存，依次拉取六张表（并行）。"""
    # 清空缓存，模拟冷启动
    client._cached_token = None
    client._cached_token_expires = 0

    t0 = time.perf_counter()

    async def fetch_one(tid: str, name: str) -> tuple[str, dict]:
        result = await test_list_table(client, tid, name)
        return name, result

    tasks = [fetch_one(tid, name) for name, tid in core_tables.items() if tid]
    pairs = await asyncio.gather(*tasks)

    total = time.perf_counter() - t0
    results = dict(pairs)
    results["_total"] = total
    return results


async def main():
    settings = load_settings()
    if settings is None:
        return

    print("=" * 60)
    print("飞书 Bitable API 网络延迟基准测试")
    print("=" * 60)
    print(f"App ID: {settings.feishu_app_id[:8]}...")
    print(f"环境: {settings.app_env}")
    print()

    client = BYTableClient(settings)

    try:
        # ── 1. 连接建立延迟 ──
        print("── 1. 网络连接延迟 ──")
        conn = await test_connection_establishment(client)
        for k, v in conn.items():
            err = v.get("error")
            if err:
                print(f"  {k}: {format_ms(v['elapsed'])} ❌ {err}")
            else:
                print(f"  {k}: {format_ms(v['elapsed'])} (HTTP {v.get('status','?')})")
        print()

        # ── 2. Token 获取延迟 ──
        print("── 2. tenant_access_token ──")
        tokens = await test_tenant_token(client)
        for k, v in tokens.items():
            if v["error"]:
                print(f"  {k}: {format_ms(v['elapsed'])} ❌ {v['error']}")
            else:
                print(f"  {k}: {format_ms(v['elapsed'])}")
        print()

        # ── 3. 逐表读取延迟 ──
        print("── 3. 六表全量读取 ──")
        core_tables = {
            "分类": settings.bitable_table_categories,
            "库位": settings.bitable_table_locations,
            "物料": settings.bitable_table_materials,
            "库存": settings.bitable_table_inventory,
            "流水": settings.bitable_table_transactions,
            "申请单": settings.bitable_table_requests,
        }
        for name, tid in core_tables.items():
            if not tid:
                print(f"  {name}: 未配置 table_id，跳过")
                continue
            result = await test_list_table(client, tid, name)
            err = result.get("error")
            if err:
                print(f"  {name}: {format_ms(result['elapsed'])} ❌ {err}")
            else:
                per_page = result["elapsed"] / max(result["pages"], 1)
                print(f"  {name}: {result['records']}条/{result['pages']}页 "
                      f"耗时 {format_ms(result['elapsed'])} "
                      f"(均 {format_ms(per_page)}/页)")
        print()

        # ── 4. 完整冷启动模拟（并行拉取）──
        print("── 4. 冷启动完整模拟 (六表并行) ──")
        cold = await test_cold_start_full(client, core_tables)
        total = cold.pop("_total")
        total_records = sum(v.get("records", 0) for v in cold.values())
        total_pages = sum(v.get("pages", 0) for v in cold.values())
        errors = [(k, v["error"]) for k, v in cold.items() if v.get("error")]
        print(f"  总记录数: {total_records} 条 / {total_pages} 页")
        print(f"  并行总耗时: {format_ms(total)}")
        if total_pages > 0:
            print(f"  等效单页延迟: {format_ms(total / total_pages)}")
        if errors:
            for name, err in errors:
                print(f"  ⚠ {name}: {err}")
        print()

        # ── 5. 汇总对比 ──
        print("── 5. 性能汇总 ──")
        print(f"  冷连接 (TCP+TLS):   {format_ms(conn.get('connect_cold', {}).get('elapsed', 0))}")
        print(f"  热连接 (复用池):    {format_ms(conn.get('connect_warm2', {}).get('elapsed', 0))}")
        print(f"  Token 首次获取:    {format_ms(tokens.get('tenant_token_cold', {}).get('elapsed', 0))}")
        print(f"  Token 缓存命中:    {format_ms(tokens.get('tenant_token_warm', {}).get('elapsed', 0))}")
        print(f"  六表并行冷启动:    {format_ms(total)}")
        print()
        print("✅ 基准测试完成")

    finally:
        await client.close()


if __name__ == "__main__":
    asyncio.run(main())
