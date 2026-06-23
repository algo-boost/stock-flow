"""SQLite 流水查询性能测试 — 模拟万级数据"""
import json, os, sys, time, tempfile, random

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from app.bitable.sqlite_cache import SqliteCache

TX_TABLE = "tbl_test_transactions"

def make_record(i: int):
    return {
        "record_id": f"rec_{i:08d}",
        "fields": {
            "交易类型": random.choice(["入库", "出库", "移动"]),
            "物料ID": f"mat_{random.randint(1, 200):04d}",
            "数量": random.randint(1, 100),
            "操作人": random.choice(["管理员", "张工", "李工"]),
        },
        "created_time": f"2026-06-{random.randint(1,23):02d}T{random.randint(8,20):02d}:{random.randint(0,59):02d}:00Z",
    }

def bench(label, count, fn):
    t0 = time.perf_counter()
    result = fn()
    elapsed = (time.perf_counter() - t0) * 1000
    if isinstance(result, tuple):
        rows, total = result
        print(f"  {label}: {elapsed:.1f}ms (返回 {rows} 条，共 {total} 条)")
    else:
        print(f"  {label}: {elapsed:.1f}ms")
    return elapsed

def main():
    db_path = tempfile.mktemp(suffix=".db")
    cache = SqliteCache(db_path)

    sizes = [100, 1_000, 10_000, 50_000, 100_000]
    print("=" * 60)
    print("SQLite 流水查询性能测试")
    print("=" * 60)

    for size in sizes:
        print(f"\n--- 写入 {size:,} 条流水 ---")
        batch = [make_record(i) for i in range(size)]
        t0 = time.perf_counter()
        cache.upsert_records(TX_TABLE, batch)
        write_ms = (time.perf_counter() - t0) * 1000
        print(f"  写入耗时: {write_ms:.0f}ms ({size/write_ms*1000:.0f} 条/秒)")

        bench("查最新 50 条 (分页查询)", size,
            lambda: cache.query_records(TX_TABLE, limit=50, offset=0))

        # 2. 翻到中间页 (offset=5000)
        if size >= 10_000:
            bench("翻到第 100 页 (offset=5000)", size,
                lambda: cache.query_records(TX_TABLE, limit=50, offset=5000))

        # 2b. 翻到最后一页 (offset≈size)
        if size >= 50_000:
            bench(f"翻到最后一页 (offset={size-50})", size,
                lambda: cache.query_records(TX_TABLE, limit=50, offset=size-50))

        # 3. 按物料查
        bench(f"按物料ID过滤 (mat_0050)", size,
            lambda: cache.query_records(TX_TABLE, limit=50, offset=0, material_id="mat_0050"))

        # 4. 全量扫（对比）
        t0 = time.perf_counter()
        raw = cache.get_records(TX_TABLE)
        raw_ms = (time.perf_counter() - t0) * 1000
        print(f"  全量扫描 ({len(raw)} 条): {raw_ms:.0f}ms {'⚠️ 无索引全扫' if raw_ms > 1000 else ''}")

        print(f"  活跃/归档: {cache.archive_stats(TX_TABLE)}")

    # 测试归档
    print(f"\n--- 归档测试 ({sizes[-1]:,} 条) ---")
    archived = cache.archive_before(TX_TABLE, 0)  # 0 = 全部归档
    print(f"  归档了 {archived} 条")

    bench("归档后查主表", sizes[-1],
        lambda: cache.query_records(TX_TABLE, limit=50, offset=0))

    stats = cache.archive_stats(TX_TABLE)
    print(f"  主表 {stats['active']:,} · 归档 {stats['archived']:,}")

    cache.close()
    os.unlink(db_path)
    print("\n✅ 测试完成")

if __name__ == "__main__":
    main()
