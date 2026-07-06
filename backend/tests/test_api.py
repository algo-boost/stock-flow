from __future__ import annotations

import asyncio

import httpx
import pytest
from fastapi.testclient import TestClient

from app.bitable.client import BYTableClient
from app.bitable.repository import BitableRepository
from app.config import Settings, get_settings
from app.main import app
from app.models import Role
from app.services.feishu_client import FeishuClient
from app.bitable.mock_store import reset_mock_store
from app.utils.idempotency import clear_idempotency_cache

app.dependency_overrides[get_settings] = lambda: Settings(
    bitable_mode="mock",
    mock_auth_enabled=True,
    bitable_warmup_on_startup=False,
)

client = TestClient(app)
HEADERS_USER = {"X-Mock-Role": "USER", "X-Mock-User": "test_user"}
HEADERS_KEEPER = {"X-Mock-Role": "KEEPER", "X-Mock-User": "test_keeper"}
HEADERS_ADMIN = {"X-Mock-Role": "ADMIN", "X-Mock-User": "test_admin"}

CABINET_SLOT = {"row": 1, "column": 1}
CABINET_SLOT_ALT = {"row": 2, "column": 3}


@pytest.fixture(autouse=True)
def reset_idempotency():
    reset_mock_store()
    clear_idempotency_cache()
    yield
    reset_mock_store()
    clear_idempotency_cache()


def test_health():
    resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


def test_search_feishu_users_mock():
    resp = client.get("/api/users/search?q=张", headers=HEADERS_KEEPER)
    assert resp.status_code == 200
    items = resp.json()["data"]
    assert any(item["name"] == "张工" for item in items)


def test_inbound_with_applicant_proxy():
    resp = client.post(
        "/api/inbound",
        headers=HEADERS_KEEPER,
        json={
            "material_id": "mat_001",
            "location_id": "loc_02",
            "qty": 1,
            "idempotency_key": "proxy-inbound-1",
            "row": 1,
            "applicant_open_id": "user_zhang",
            "applicant_name": "张工",
        },
    )
    assert resp.status_code == 200
    txs_body = client.get("/api/transactions", headers=HEADERS_ADMIN).json()["data"]
    txs = txs_body["items"]
    assert any(tx.get("operator") == "张工" and tx.get("type") == "入库" for tx in txs)


def test_bitable_list_records_treats_null_items_as_empty(monkeypatch):
    bitable = BYTableClient(
        Settings(
            bitable_mode="real",
            bitable_app_token="app_token",
            feishu_app_id="cli_xxx",
            feishu_app_secret="secret",
        )
    )

    async def fake_tenant_token():
        return "tenant-token"

    async def fake_request(*args, **kwargs):
        return httpx.Response(
            200,
            json={"code": 0, "data": {"items": None, "has_more": False}},
        )

    monkeypatch.setattr(bitable, "_tenant_token", fake_tenant_token)
    monkeypatch.setattr(bitable, "_request", fake_request)

    assert asyncio.run(bitable.list_records("tbl_empty")) == []


def test_role_defaults_to_user_when_groups_empty():
    client_obj = FeishuClient(
        Settings(
            feishu_app_id="cli_xxx",
            feishu_app_secret="secret",
            feishu_group_admin="",
            feishu_group_keeper="",
            feishu_group_user="",
        )
    )

    role, meta = asyncio.run(client_obj.resolve_role_with_meta("ou_default_user", "user-token"))
    assert role == Role.USER
    assert meta["source"] == "default"
    assert meta["method"] == "no_group_config"
    assert meta["warning"] is None


def test_me():
    resp = client.get("/api/me", headers=HEADERS_USER)
    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == 0
    assert body["data"]["user"]["role"] == "USER"


def test_search_materials():
    resp = client.get("/api/materials/search?q=大喵", headers=HEADERS_USER)
    assert resp.status_code == 200
    items = resp.json()["data"]["items"]
    assert len(items) >= 1
    assert items[0]["name"] == "大喵电机"
    assert "total_quantity" in items[0]
    assert "locations_summary" in items[0]


def test_search_materials_by_name():
    resp = client.get("/api/materials/search?q=大喵&search_by=name", headers=HEADERS_USER)
    assert resp.status_code == 200
    items = resp.json()["data"]["items"]
    assert any(item["name"] == "大喵电机" for item in items)


def test_search_materials_by_code():
    resp = client.get("/api/materials/search?q=M001&search_by=code", headers=HEADERS_USER)
    assert resp.status_code == 200
    items = resp.json()["data"]["items"]
    assert len(items) >= 1
    assert all("M001" in item["code"] or item.get("barcode") == "M001" for item in items)


def test_search_materials_by_category_tree():
    resp = client.get("/api/materials/search?category=cat_sensing", headers=HEADERS_USER)
    assert resp.status_code == 200
    items = resp.json()["data"]["items"]
    assert len(items) >= 2
    assert all(item["sub_category"] == "感知设备" for item in items)


def test_search_materials_stock_only():
    resp = client.get("/api/materials/search?stock_only=true", headers=HEADERS_USER)
    assert resp.status_code == 200
    items = resp.json()["data"]["items"]
    assert len(items) >= 1
    assert all(item["total_quantity"] > 0 for item in items)


def test_search_materials_out_of_stock():
    resp = client.get("/api/materials/search?out_of_stock=true", headers=HEADERS_USER)
    assert resp.status_code == 200
    items = resp.json()["data"]["items"]
    assert len(items) >= 1
    assert all(item["total_quantity"] <= 0 for item in items)
    assert any(item["name"] == "测试缺货物料" for item in items)


def test_search_materials_low_stock():
    resp = client.get("/api/materials/search?low_stock=true", headers=HEADERS_USER)
    assert resp.status_code == 200
    items = resp.json()["data"]["items"]
    assert len(items) >= 1
    assert all(0 < item["total_quantity"] < (item.get("min_stock") or 5) for item in items)


def test_list_material_categories():
    resp = client.get("/api/materials/categories", headers=HEADERS_USER)
    assert resp.status_code == 200
    categories = resp.json()["data"]
    assert any(category["name"] == "电机模组" for category in categories)
    assert any(category["name"] == "电气类" and category["parent_id"] is None for category in categories)


def test_category_crud_admin():
    create_resp = client.post(
        "/api/materials/categories",
        headers=HEADERS_ADMIN,
        json={"name": "测试一级", "parent_id": None},
    )
    assert create_resp.status_code == 200
    category = create_resp.json()["data"]
    assert category["name"] == "测试一级"

    child_resp = client.post(
        "/api/materials/categories",
        headers=HEADERS_ADMIN,
        json={"name": "测试子类", "parent_id": category["id"]},
    )
    assert child_resp.status_code == 200

    delete_parent = client.delete(f"/api/materials/categories/{category['id']}", headers=HEADERS_ADMIN)
    assert delete_parent.status_code == 200


def test_delete_leaf_category_reassigns_material():
    resp = client.delete("/api/materials/categories/cat_motor_module", headers=HEADERS_ADMIN)
    assert resp.status_code == 200
    material = client.get("/api/materials/mat_001", headers=HEADERS_USER).json()["data"]["material"]
    assert material["category_id"] == "cat_electrical"
    assert material["category_name"] == "电气类"


def test_category_create_forbidden_for_user():
    resp = client.post(
        "/api/materials/categories",
        headers=HEADERS_USER,
        json={"name": "无权限分类", "parent_id": None},
    )
    assert resp.status_code == 403


def test_location_create_forbidden_for_user():
    resp = client.post(
        "/api/locations",
        headers=HEADERS_USER,
        json={"code": "DENY-01", "name": "无权限库位", "type": "货柜"},
    )
    assert resp.status_code == 403


def test_location_crud_for_keeper_when_empty():
    create_resp = client.post(
        "/api/locations",
        headers=HEADERS_KEEPER,
        json={"code": "TEST-EMPTY-01", "name": "测试空库位", "type": "货架"},
    )
    assert create_resp.status_code == 200
    location = create_resp.json()["data"]
    assert location["name"] == "测试空库位"

    update_resp = client.patch(
        f"/api/locations/{location['id']}",
        headers=HEADERS_KEEPER,
        json={"name": "测试空库位-改名"},
    )
    assert update_resp.status_code == 200
    assert update_resp.json()["data"]["name"] == "测试空库位-改名"

    delete_resp = client.delete(f"/api/locations/{location['id']}", headers=HEADERS_KEEPER)
    assert delete_resp.status_code == 200
    assert delete_resp.json()["data"]["deleted"] is True

    list_resp = client.get("/api/locations", headers=HEADERS_KEEPER)
    ids = {item["id"] for item in list_resp.json()["data"]}
    assert location["id"] not in ids


def test_location_delete_blocked_when_inventory_exists():
    resp = client.delete("/api/locations/loc_01", headers=HEADERS_KEEPER)
    assert resp.status_code == 400
    body = resp.json()
    assert body["code"] == 4003
    assert "请先移空" in body["message"]


def test_create_material_forbidden_for_user():
    resp = client.post(
        "/api/materials",
        headers=HEADERS_USER,
        json={
            "name": "测试新物料-无权限",
            "category_id": "cat_motor_module",
            "unit": "个",
        },
    )
    assert resp.status_code == 403


def test_create_material_success_for_keeper():
    resp = client.post(
        "/api/materials",
        headers=HEADERS_KEEPER,
        json={
            "name": "测试新物料",
            "category_id": "cat_motor_module",
            "major_category": "电气类",
            "sub_category": "电机模组",
            "unit": "个",
            "spec": "测试规格",
            "default_location_id": "loc_01",
            "supplier": "测试供货商",
            "min_stock": 5,
        },
    )
    assert resp.status_code == 200
    material = resp.json()["data"]
    assert material["id"]
    assert material["name"] == "测试新物料"
    assert material["category_name"] == "电机模组"
    assert material["major_category"] == "电气类"
    assert material["sub_category"] == "电机模组"
    assert material["supplier"] == "测试供货商"
    assert material["min_stock"] == 5

    detail_resp = client.get(f"/api/materials/{material['id']}", headers=HEADERS_KEEPER)
    assert detail_resp.status_code == 200
    assert detail_resp.json()["data"]["material"]["name"] == "测试新物料"


def test_update_material_success_for_keeper():
    create_resp = client.post(
        "/api/materials",
        headers=HEADERS_KEEPER,
        json={
            "name": "待修改物料",
            "category_id": "cat_motor_module",
            "unit": "个",
        },
    )
    material_id = create_resp.json()["data"]["id"]

    patch_resp = client.patch(
        f"/api/materials/{material_id}",
        headers=HEADERS_KEEPER,
        json={"name": "已修改物料", "spec": "新规格"},
    )
    assert patch_resp.status_code == 200
    updated = patch_resp.json()["data"]
    assert updated["name"] == "已修改物料"
    assert updated["spec"] == "新规格"


def test_delete_material_success_when_no_stock_or_transactions():
    create_resp = client.post(
        "/api/materials",
        headers=HEADERS_KEEPER,
        json={
            "name": "待删除物料",
            "category_id": "cat_motor_module",
            "unit": "个",
        },
    )
    material_id = create_resp.json()["data"]["id"]

    delete_resp = client.delete(f"/api/materials/{material_id}", headers=HEADERS_KEEPER)
    assert delete_resp.status_code == 200
    assert delete_resp.json()["data"]["deleted"] is True

    detail_resp = client.get(f"/api/materials/{material_id}", headers=HEADERS_KEEPER)
    assert detail_resp.status_code == 404


def test_delete_material_forbidden_for_user():
    create_resp = client.post(
        "/api/materials",
        headers=HEADERS_KEEPER,
        json={
            "name": "普通用户不可删",
            "category_id": "cat_motor_module",
            "unit": "个",
        },
    )
    material_id = create_resp.json()["data"]["id"]

    delete_resp = client.delete(f"/api/materials/{material_id}", headers=HEADERS_USER)
    assert delete_resp.status_code == 403


def test_purchase_inbound_admin_only_updates_supplier_and_inventory():
    forbidden = client.post(
        "/api/purchase-inbound",
        headers=HEADERS_KEEPER,
        json={
            "material_id": "mat_001",
            "location_id": "loc_01",
            "qty": 1,
            "idempotency_key": "test-purchase-deny",
            "supplier": "无权限供货商",
            "note": "不应成功",
        },
    )
    assert forbidden.status_code == 403

    before = client.get("/api/materials/mat_001", headers=HEADERS_ADMIN).json()["data"]
    before_total = before["total_quantity"]
    resp = client.post(
        "/api/purchase-inbound",
        headers=HEADERS_ADMIN,
        json={
            "material_id": "mat_001",
            "location_id": "loc_01",
            "qty": 2,
            "idempotency_key": "test-purchase-admin-001",
            "supplier": "管理员供货商",
            "note": "补货测试",
            **CABINET_SLOT_ALT,
        },
    )
    assert resp.status_code == 200
    tx_id = resp.json()["data"]["transaction_id"]
    assert tx_id

    after = client.get("/api/materials/mat_001", headers=HEADERS_ADMIN).json()["data"]
    assert after["total_quantity"] == before_total + 2
    assert after["material"]["supplier"] == "管理员供货商"

    txs = client.get("/api/materials/mat_001/transactions", headers=HEADERS_ADMIN).json()["data"]
    assert any(
        tx["id"] == tx_id
        and tx["quantity"] == 2
        and "管理员进货" in (tx["remark"] or "")
        and "管理员供货商" in (tx["remark"] or "")
        for tx in txs
    )


def test_low_stock_alerts_less_than_threshold_only():
    create_resp = client.post(
        "/api/materials",
        headers=HEADERS_KEEPER,
        json={
            "name": "低库存边界测试物料",
            "category_id": "cat_motor_module",
            "unit": "个",
            "default_location_id": "loc_01",
            "supplier": "边界供货商",
            "min_stock": 5,
        },
    )
    assert create_resp.status_code == 200
    material = create_resp.json()["data"]

    low_resp = client.get("/api/inventory/low-stock", headers=HEADERS_ADMIN)
    assert low_resp.status_code == 200
    low_items = low_resp.json()["data"]
    assert any(item["id"] == material["id"] and item["threshold"] == 5 for item in low_items)

    forbidden = client.get("/api/inventory/low-stock", headers=HEADERS_KEEPER)
    assert forbidden.status_code == 403

    purchase_resp = client.post(
        "/api/purchase-inbound",
        headers=HEADERS_ADMIN,
        json={
            "material_id": material["id"],
            "location_id": "loc_01",
            "qty": 5,
            "idempotency_key": "test-low-stock-fill",
            "supplier": "边界供货商",
            **CABINET_SLOT,
        },
    )
    assert purchase_resp.status_code == 200

    low_after = client.get("/api/inventory/low-stock", headers=HEADERS_ADMIN).json()["data"]
    assert all(item["id"] != material["id"] for item in low_after)


def test_outbound_forbidden_for_user():
    resp = client.post(
        "/api/outbound",
        headers=HEADERS_USER,
        json={
            "material_id": "mat_001",
            "location_id": "loc_01",
            "qty": 1,
            "idempotency_key": "test-outbound-user-deny",
            "note": "项目测试领用",
            "return_required": False,
        },
    )
    assert resp.status_code == 403


def test_outbound_success_for_keeper():
    key = "test-outbound-key-001"
    resp = client.post(
        "/api/outbound",
        headers=HEADERS_KEEPER,
        json={
            "material_id": "mat_001",
            "location_id": "loc_01",
            "qty": 1,
            "idempotency_key": key,
            "note": "项目测试领用",
            "return_required": True,
            "return_due_at": "2026-06-30",
        },
    )
    assert resp.status_code == 200
    assert resp.json()["code"] == 0
    tx_id = resp.json()["data"]["transaction_id"]
    assert tx_id

    # 幂等：重复请求返回相同结果
    resp2 = client.post(
        "/api/outbound",
        headers=HEADERS_KEEPER,
        json={
            "material_id": "mat_001",
            "location_id": "loc_01",
            "qty": 1,
            "idempotency_key": key,
            "note": "项目测试领用",
            "return_required": True,
            "return_due_at": "2026-06-30",
        },
    )
    assert resp2.json()["data"]["transaction_id"] == tx_id

    tx_resp = client.get("/api/materials/mat_001/transactions", headers=HEADERS_KEEPER)
    assert tx_resp.status_code == 200
    txs = tx_resp.json()["data"]
    matched = next(tx for tx in txs if tx["id"] == tx_id and tx["quantity"] < 0)
    assert "需归还：2026-06-30" in (matched.get("remark") or "")


def test_outbound_insufficient_stock():
    resp = client.post(
        "/api/outbound",
        headers=HEADERS_KEEPER,
        json={
            "material_id": "mat_001",
            "location_id": "loc_01",
            "qty": 9999,
            "idempotency_key": "test-outbound-overflow",
            "note": "超额领用",
            "return_required": False,
        },
    )
    assert resp.status_code == 400
    assert resp.json()["code"] == 4002


def test_user_request_approved_by_admin_creates_history():
    create_resp = client.post(
        "/api/requests",
        headers=HEADERS_USER,
        json={
            "type": "出库",
            "material_id": "mat_realsense",
            "location_id": "loc_01",
            "qty": 1,
            "idempotency_key": "test-request-outbound-001",
            "note": "项目申请领用",
            "return_required": True,
            "return_due_at": "2026-07-01",
        },
    )
    assert create_resp.status_code == 200
    request_id = create_resp.json()["data"]["request_id"]

    mine_resp = client.get("/api/requests/mine", headers=HEADERS_USER)
    assert mine_resp.status_code == 200
    assert any(item["id"] == request_id and item["status"] == "待审批" for item in mine_resp.json()["data"])

    pending_resp = client.get("/api/requests?status=待审批", headers=HEADERS_ADMIN)
    assert pending_resp.status_code == 200
    assert any(item["id"] == request_id for item in pending_resp.json()["data"])

    approve_resp = client.post(f"/api/requests/{request_id}/approve", headers=HEADERS_ADMIN)
    assert approve_resp.status_code == 200
    approved = approve_resp.json()["data"]
    assert approved["status"] == "已通过"
    assert approved["transaction_id"]

    history_resp = client.get("/api/transactions", headers=HEADERS_USER)
    assert history_resp.status_code == 200
    txs = history_resp.json()["data"]["items"]
    assert any(tx["id"] == approved["transaction_id"] and tx["operator"] == "研发用户" for tx in txs)


def test_approved_outbound_with_return_required_lists_pending_return():
    create_resp = client.post(
        "/api/requests",
        headers=HEADERS_USER,
        json={
            "type": "出库",
            "material_id": "mat_realsense",
            "location_id": "loc_01",
            "qty": 1,
            "idempotency_key": "test-request-pending-return-001",
            "note": "项目申请领用",
            "return_required": True,
            "return_due_at": "2026-07-15",
        },
    )
    assert create_resp.status_code == 200
    request_id = create_resp.json()["data"]["request_id"]

    approve_resp = client.post(f"/api/requests/{request_id}/approve", headers=HEADERS_ADMIN)
    assert approve_resp.status_code == 200

    pending_resp = client.get("/api/returns/pending?borrower=研发用户", headers=HEADERS_ADMIN)
    assert pending_resp.status_code == 200
    items = pending_resp.json()["data"]
    assert len(items) == 1
    assert items[0]["quantity"] == 1
    assert items[0]["return_due_at"] == "2026-07-15"


def test_user_inbound_request_without_location_approved_by_admin():
    create_resp = client.post(
        "/api/requests",
        headers=HEADERS_USER,
        json={
            "type": "入库",
            "material_id": "mat_001",
            "qty": 1,
            "idempotency_key": "test-request-inbound-no-loc-001",
            "note": "项目结束归还",
        },
    )
    assert create_resp.status_code == 200
    request_id = create_resp.json()["data"]["request_id"]

    pending_resp = client.get("/api/requests?status=待审批", headers=HEADERS_ADMIN)
    pending_item = next(item for item in pending_resp.json()["data"] if item["id"] == request_id)
    assert pending_item["location_id"] is None

    approve_resp = client.post(
        f"/api/requests/{request_id}/approve",
        headers=HEADERS_ADMIN,
        json={"location_id": "loc_01", "row": 2, "column": 3},
    )
    assert approve_resp.status_code == 200
    approved = approve_resp.json()["data"]
    assert approved["status"] == "已通过"
    assert approved["location_id"] == "loc_01"
    assert approved["transaction_id"]


def test_inbound_keeps_separate_cabinet_slots():
    client.post(
        "/api/inbound",
        headers=HEADERS_KEEPER,
        json={
            "material_id": "mat_001",
            "location_id": "loc_01",
            "qty": 5,
            "idempotency_key": "slot-inbound-1-9",
            "note": "首批",
            "row": 1,
            "column": 9,
        },
    )
    client.post(
        "/api/inbound",
        headers=HEADERS_KEEPER,
        json={
            "material_id": "mat_001",
            "location_id": "loc_01",
            "qty": 2,
            "idempotency_key": "slot-inbound-1-10",
            "note": "第二批",
            "row": 1,
            "column": 10,
        },
    )
    detail = client.get("/api/materials/mat_001", headers=HEADERS_KEEPER).json()["data"]
    slots = {
        (item["row"], item["column"]): item["quantity"]
        for item in detail["inventory"]
        if item["location_id"] == "loc_01"
    }
    assert slots[(1, 9)] == 5
    assert slots[(1, 10)] == 2
    assert detail["total_quantity"] == 10


def test_inbound_rack_row_only():
    resp = client.post(
        "/api/inbound",
        headers=HEADERS_KEEPER,
        json={
            "material_id": "mat_001",
            "location_id": "loc_02",
            "qty": 3,
            "idempotency_key": "rack-row-only-1",
            "note": "货架层入库",
            "row": 2,
        },
    )
    assert resp.status_code == 200
    detail = client.get("/api/materials/mat_001", headers=HEADERS_KEEPER).json()["data"]
    rack_items = [item for item in detail["inventory"] if item["location_id"] == "loc_02"]
    assert any(item["row"] == 2 and item["column"] is None and item["quantity"] == 3 for item in rack_items)


def test_inbound_cabinet_row_without_column_rejected():
    resp = client.post(
        "/api/inbound",
        headers=HEADERS_KEEPER,
        json={
            "material_id": "mat_001",
            "location_id": "loc_01",
            "qty": 1,
            "idempotency_key": "cabinet-incomplete",
            "row": 2,
        },
    )
    assert resp.status_code == 400
    assert "行号" in resp.json()["message"]


def test_update_second_inventory_slot():
    client.post(
        "/api/inbound",
        headers=HEADERS_KEEPER,
        json={
            "material_id": "mat_001",
            "location_id": "loc_01",
            "qty": 7,
            "idempotency_key": "slot-update-a",
            "note": "A",
            "row": 1,
            "column": 9,
        },
    )
    client.post(
        "/api/inbound",
        headers=HEADERS_KEEPER,
        json={
            "material_id": "mat_001",
            "location_id": "loc_01",
            "qty": 4,
            "idempotency_key": "slot-update-b",
            "note": "B",
            "row": 1,
            "column": 5,
        },
    )
    resp = client.patch(
        "/api/materials/mat_001/inventory/loc_01/slot",
        headers=HEADERS_KEEPER,
        json={"row": 1, "column": 7, "from_row": 1, "from_column": 5},
    )
    assert resp.status_code == 200
    detail = client.get("/api/materials/mat_001", headers=HEADERS_KEEPER).json()["data"]
    slots = {
        (item["row"], item["column"]): item["quantity"]
        for item in detail["inventory"]
        if item["location_id"] == "loc_01"
    }
    assert slots[(1, 9)] == 7
    assert slots[(1, 7)] == 4
    assert (1, 5) not in slots


def test_outbound_request_approval_uses_cabinet_slot():
    client.post(
        "/api/inbound",
        headers=HEADERS_KEEPER,
        json={
            "material_id": "mat_001",
            "location_id": "loc_01",
            "qty": 5,
            "idempotency_key": "slot-outbound-setup",
            "note": "格位备货",
            "row": 1,
            "column": 6,
        },
    )
    create_resp = client.post(
        "/api/requests",
        headers=HEADERS_USER,
        json={
            "type": "出库",
            "material_id": "mat_001",
            "location_id": "loc_01",
            "qty": 1,
            "idempotency_key": "slot-outbound-req-01",
            "note": "实验领用",
            "return_required": True,
            "return_due_at": "2026-07-01",
            "row": 1,
            "column": 6,
        },
    )
    assert create_resp.status_code == 200
    request_id = create_resp.json()["data"]["request_id"]

    approve_resp = client.post(
        f"/api/requests/{request_id}/approve",
        headers=HEADERS_ADMIN,
        json={"row": 1, "column": 6},
    )
    assert approve_resp.status_code == 200

    detail = client.get("/api/materials/mat_001", headers=HEADERS_KEEPER).json()["data"]
    slots = {
        (item["row"], item["column"]): item["quantity"]
        for item in detail["inventory"]
        if item["location_id"] == "loc_01" and item.get("row") is not None
    }
    assert slots[(1, 6)] == 4


def test_outbound_request_approval_requires_slot_when_missing():
    client.post(
        "/api/inbound",
        headers=HEADERS_KEEPER,
        json={
            "material_id": "mat_001",
            "location_id": "loc_01",
            "qty": 2,
            "idempotency_key": "slot-outbound-auto-setup",
            "note": "格位备货",
            "row": 1,
            "column": 7,
        },
    )
    create_resp = client.post(
        "/api/requests",
        headers=HEADERS_USER,
        json={
            "type": "出库",
            "material_id": "mat_001",
            "location_id": "loc_01",
            "qty": 1,
            "idempotency_key": "slot-outbound-req-02",
            "note": "无格位旧申请",
            "return_required": False,
        },
    )
    assert create_resp.status_code == 200
    request_id = create_resp.json()["data"]["request_id"]

    approve_resp = client.post(f"/api/requests/{request_id}/approve", headers=HEADERS_ADMIN)
    assert approve_resp.status_code == 400
    assert "格位" in approve_resp.json()["message"]


def test_inbound_forbidden_for_user():
    resp = client.post(
        "/api/inbound",
        headers=HEADERS_USER,
        json={
            "material_id": "mat_001",
            "location_id": "loc_01",
            "qty": 1,
            "idempotency_key": "test-inbound-user-deny",
            "note": "归还",
        },
    )
    assert resp.status_code == 403


def test_inbound_success_for_keeper():
    resp = client.post(
        "/api/inbound",
        headers=HEADERS_KEEPER,
        json={
            "material_id": "mat_001",
            "location_id": "loc_01",
            "qty": 2,
            "idempotency_key": "test-inbound-keeper-001",
            "note": "采购入库",
            **CABINET_SLOT_ALT,
        },
    )
    assert resp.status_code == 200
    assert resp.json()["code"] == 0


def test_inbound_updates_material_spec_for_keeper():
    resp = client.post(
        "/api/inbound",
        headers=HEADERS_KEEPER,
        json={
            "material_id": "mat_001",
            "location_id": "loc_01",
            "qty": 1,
            "idempotency_key": "test-inbound-spec-001",
            "note": "补型号",
            "spec": "D435i 新版",
            **CABINET_SLOT_ALT,
        },
    )
    assert resp.status_code == 200
    detail = client.get("/api/materials/mat_001", headers=HEADERS_KEEPER).json()["data"]
    assert detail["material"]["spec"] == "D435i 新版"


def test_transfer_forbidden_for_user():
    resp = client.post(
        "/api/transfer",
        headers=HEADERS_USER,
        json={
            "material_id": "mat_realsense",
            "from_location_id": "loc_01",
            "to_location_id": "loc_staging",
            "qty": 1,
            "idempotency_key": "test-transfer-user-deny",
            "note": "整理库位",
        },
    )
    assert resp.status_code == 403


def test_transfer_success_for_keeper():
    key = "test-transfer-keeper-001"
    resp = client.post(
        "/api/transfer",
        headers=HEADERS_KEEPER,
        json={
            "material_id": "mat_realsense",
            "from_location_id": "loc_01",
            "to_location_id": "loc_staging",
            "qty": 1,
            "idempotency_key": key,
            "note": "快递暂存上架",
            "from_row": 1,
            "from_column": 1,
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == 0
    tx_ids = body["data"]["transaction_ids"]
    assert len(tx_ids) == 1

    resp2 = client.post(
        "/api/transfer",
        headers=HEADERS_KEEPER,
        json={
            "material_id": "mat_realsense",
            "from_location_id": "loc_01",
            "to_location_id": "loc_staging",
            "qty": 1,
            "idempotency_key": key,
            "note": "快递暂存上架",
            "from_row": 1,
            "from_column": 1,
        },
    )
    assert resp2.json()["data"]["transaction_ids"] == tx_ids

    detail = client.get("/api/materials/mat_realsense", headers=HEADERS_KEEPER).json()["data"]
    by_location = {item["location_id"]: item["quantity"] for item in detail["inventory"]}
    assert by_location["loc_staging"] >= 1

    tx_resp = client.get("/api/materials/mat_realsense/transactions", headers=HEADERS_KEEPER)
    txs = tx_resp.json()["data"]
    movement = [tx for tx in txs if tx["id"] in tx_ids]
    assert {tx["type"] for tx in movement} == {"移动"}
    assert [tx["quantity"] for tx in movement] == [-1]
    assert "移动至" in movement[0]["remark"]


def test_delete_outbound_transaction_reverts_inventory():
    before = client.get("/api/materials/mat_001", headers=HEADERS_ADMIN).json()["data"]
    qty_before = sum(i["quantity"] for i in before["inventory"])

    outbound = client.post(
        "/api/outbound",
        headers=HEADERS_KEEPER,
        json={
            "material_id": "mat_001",
            "location_id": "loc_01",
            "qty": 1,
            "idempotency_key": "test-delete-outbound-setup",
            "note": "删除冲正测试",
            "return_required": False,
        },
    )
    assert outbound.status_code == 200
    tx_id = outbound.json()["data"]["transaction_id"]

    after_out = client.get("/api/materials/mat_001", headers=HEADERS_ADMIN).json()["data"]
    qty_after_out = sum(i["quantity"] for i in after_out["inventory"])
    assert qty_after_out == qty_before - 1

    del_resp = client.delete(f"/api/admin/transactions/{tx_id}", headers=HEADERS_ADMIN)
    assert del_resp.status_code == 200

    after_del = client.get("/api/materials/mat_001", headers=HEADERS_ADMIN).json()["data"]
    qty_after_del = sum(i["quantity"] for i in after_del["inventory"])
    assert qty_after_del == qty_before

    txs = client.get("/api/materials/mat_001/transactions", headers=HEADERS_ADMIN).json()["data"]
    assert not any(tx["id"] == tx_id for tx in txs)


def test_delete_inbound_transaction_reverts_inventory():
    inbound = client.post(
        "/api/inbound",
        headers=HEADERS_KEEPER,
        json={
            "material_id": "mat_001",
            "location_id": "loc_01",
            "qty": 2,
            "idempotency_key": "test-delete-inbound-setup",
            "note": "删除冲正测试",
            **CABINET_SLOT_ALT,
        },
    )
    assert inbound.status_code == 200
    tx_id = inbound.json()["data"]["transaction_id"]

    before_del = client.get("/api/materials/mat_001", headers=HEADERS_ADMIN).json()["data"]
    qty_before_del = sum(i["quantity"] for i in before_del["inventory"])

    del_resp = client.delete(f"/api/admin/transactions/{tx_id}", headers=HEADERS_ADMIN)
    assert del_resp.status_code == 200

    after_del = client.get("/api/materials/mat_001", headers=HEADERS_ADMIN).json()["data"]
    qty_after_del = sum(i["quantity"] for i in after_del["inventory"])
    assert qty_after_del == qty_before_del - 2


def test_delete_transfer_transaction_forbidden():
    resp = client.post(
        "/api/transfer",
        headers=HEADERS_KEEPER,
        json={
            "material_id": "mat_realsense",
            "from_location_id": "loc_01",
            "to_location_id": "loc_staging",
            "qty": 1,
            "idempotency_key": "test-delete-transfer-deny",
            "note": "删除禁止测试",
        },
    )
    assert resp.status_code == 200
    tx_id = resp.json()["data"]["transaction_ids"][0]

    del_resp = client.delete(f"/api/admin/transactions/{tx_id}", headers=HEADERS_ADMIN)
    assert del_resp.status_code == 400
    assert "移动" in del_resp.json()["message"]


def test_refresh_cache_forbidden_for_user():
    resp = client.post("/api/admin/cache/refresh", headers=HEADERS_USER)
    assert resp.status_code == 403


def test_refresh_cache_success_for_keeper():
    resp = client.post("/api/admin/cache/refresh", headers=HEADERS_KEEPER)
    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == 0
    assert "缓存" in body["data"]["message"]


def test_admin_center_keeps_existing_admin_and_keeper_permissions():
    create_resp = client.post(
        "/api/locations",
        headers=HEADERS_ADMIN,
        json={"code": "ADMIN-EMPTY-01", "name": "管理员测试空库位", "type": "货柜"},
    )
    assert create_resp.status_code == 200
    location = create_resp.json()["data"]

    list_resp = client.get("/api/requests", headers=HEADERS_ADMIN)
    assert list_resp.status_code == 200

    delete_resp = client.delete(f"/api/locations/{location['id']}", headers=HEADERS_ADMIN)
    assert delete_resp.status_code == 200


def test_admin_center_endpoints_are_admin_only():
    for path in ["/api/admin/overview", "/api/admin/audit", "/api/admin/system"]:
        forbidden_user = client.get(path, headers=HEADERS_USER)
        assert forbidden_user.status_code == 403

        forbidden_keeper = client.get(path, headers=HEADERS_KEEPER)
        assert forbidden_keeper.status_code == 403

        allowed = client.get(path, headers=HEADERS_ADMIN)
        assert allowed.status_code == 200
        body = allowed.json()
        assert body["code"] == 0
        assert body["data"]


def test_admin_overview_contains_statistics():
    resp = client.get("/api/admin/overview", headers=HEADERS_ADMIN)
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert "tables" in data
    assert data["totals"]["inventory_quantity"] >= 0
    assert "pending_requests" in data["totals"]
    assert "material_count" in data["totals"]
    assert "location_distribution" in data
    assert "category_distribution" in data
    assert "pending_requests_list" in data


def test_staging_inventory_lists_staging_location_only():
    client.post(
        "/api/outbound",
        headers=HEADERS_KEEPER,
        json={
            "material_id": "mat_realsense",
            "location_id": "loc_01",
            "qty": 1,
            "idempotency_key": "proxy-return-out-001",
            "note": "代张工借用",
            "return_required": True,
            "return_due_at": "2026-07-15",
            "applicant_open_id": "user_zhang",
            "applicant_name": "张工",
        },
    )
    pending = client.get("/api/returns/pending?borrower=张工", headers=HEADERS_ADMIN)
    assert pending.status_code == 200
    items = pending.json()["data"]
    assert len(items) == 1
    assert items[0]["borrower"] == "张工"


def test_staging_inventory_lists_staging_location_only():
    resp = client.get("/api/inventory/staging", headers=HEADERS_KEEPER)
    assert resp.status_code == 200
    items = resp.json()["data"]
    assert isinstance(items, list)
    if items:
        assert all("location_name" in item for item in items)


def test_pending_returns_lists_borrow_and_clears_after_return_inbound():
    client.post(
        "/api/outbound",
        headers=HEADERS_KEEPER,
        json={
            "material_id": "mat_realsense",
            "location_id": "loc_01",
            "qty": 1,
            "idempotency_key": "pending-return-out-001",
            "note": "项目借用",
            "return_required": True,
            "return_due_at": "2026-07-01",
            **CABINET_SLOT,
        },
    )
    pending_keeper = client.get("/api/returns/pending?borrower=库管员", headers=HEADERS_ADMIN)
    assert pending_keeper.status_code == 200
    items = pending_keeper.json()["data"]
    assert len(items) == 1
    assert items[0]["quantity"] == 1
    assert items[0]["return_due_at"] == "2026-07-01"

    client.post(
        "/api/inbound",
        headers=HEADERS_KEEPER,
        json={
            "material_id": "mat_realsense",
            "location_id": "loc_01",
            "qty": 1,
            "idempotency_key": "pending-return-in-001",
            "note": "项目结束归还",
            **CABINET_SLOT,
        },
    )
    cleared = client.get("/api/returns/pending?borrower=库管员", headers=HEADERS_ADMIN)
    assert cleared.status_code == 200
    assert cleared.json()["data"] == []
