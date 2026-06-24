"""管理员纠错、库位类型、流水归档模块测试。"""

from __future__ import annotations

from tests.conftest import HEADERS_ADMIN, HEADERS_KEEPER, HEADERS_USER


def test_admin_patch_transaction_remark(client):
    outbound = client.post(
        "/api/outbound",
        headers=HEADERS_KEEPER,
        json={
            "material_id": "mat_001",
            "location_id": "loc_01",
            "qty": 1,
            "idempotency_key": "test-patch-tx-001",
            "note": "原备注",
            "return_required": False,
        },
    )
    tx_id = outbound.json()["data"]["transaction_id"]

    patch_resp = client.patch(
        f"/api/admin/transactions/{tx_id}",
        headers=HEADERS_ADMIN,
        json={"remark": "管理员纠错备注"},
    )
    assert patch_resp.status_code == 200
    assert patch_resp.json()["data"]["remark"] == "管理员纠错备注"


def test_admin_direct_inventory_update(client):
    before = client.get("/api/materials/mat_001", headers=HEADERS_ADMIN).json()["data"]
    loc_item = next(i for i in before["inventory"] if i["location_id"] == "loc_01")
    new_qty = loc_item["quantity"] + 1

    patch_resp = client.patch(
        f"/api/admin/inventory/mat_001/loc_01",
        headers=HEADERS_ADMIN,
        json={"quantity": new_qty, "remark": "盘点纠错"},
    )
    assert patch_resp.status_code == 200
    assert patch_resp.json()["data"]["quantity"] == new_qty


def test_admin_direct_inventory_forbidden_for_keeper(client):
    resp = client.patch(
        "/api/admin/inventory/mat_001/loc_01",
        headers=HEADERS_KEEPER,
        json={"quantity": 1},
    )
    assert resp.status_code == 403


def test_location_types_crud(client):
    list_resp = client.get("/api/admin/location-types", headers=HEADERS_USER)
    assert list_resp.status_code == 200
    before = list_resp.json()["data"]
    assert "货柜" in before

    add_resp = client.post(
        "/api/admin/location-types?name=测试库位类型",
        headers=HEADERS_KEEPER,
    )
    assert add_resp.status_code == 200
    assert "测试库位类型" in add_resp.json()["data"]

    rename_resp = client.patch(
        "/api/admin/location-types?old_name=测试库位类型&new_name=测试库位类型2",
        headers=HEADERS_ADMIN,
    )
    assert rename_resp.status_code == 200
    assert "测试库位类型2" in rename_resp.json()["data"]

    remove_resp = client.delete(
        "/api/admin/location-types?name=测试库位类型2",
        headers=HEADERS_ADMIN,
    )
    assert remove_resp.status_code == 200
    assert "测试库位类型2" not in remove_resp.json()["data"]


def test_transactions_archive_stats_admin_only(client):
    forbidden = client.get("/api/admin/transactions/archive-stats", headers=HEADERS_USER)
    assert forbidden.status_code == 403

    allowed = client.get("/api/admin/transactions/archive-stats", headers=HEADERS_ADMIN)
    assert allowed.status_code == 200
    data = allowed.json()["data"]
    assert "total" in data or "count" in data or isinstance(data, dict)


def test_bulk_sync_mock_mode(client):
    resp = client.post("/api/admin/bulk-sync", headers=HEADERS_ADMIN, json={})
    assert resp.status_code == 200
    assert resp.json()["code"] == 0
