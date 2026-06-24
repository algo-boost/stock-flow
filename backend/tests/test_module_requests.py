"""申请审批模块：提交、拒绝、删除、纠错。"""

from __future__ import annotations

from tests.conftest import HEADERS_ADMIN, HEADERS_USER


def _create_outbound_request(client, key: str) -> str:
    resp = client.post(
        "/api/requests",
        headers=HEADERS_USER,
        json={
            "type": "出库",
            "material_id": "mat_realsense",
            "location_id": "loc_01",
            "qty": 1,
            "idempotency_key": key,
            "note": "模块测试申请",
            "return_required": False,
        },
    )
    assert resp.status_code == 200
    return resp.json()["data"]["request_id"]


def test_reject_request_updates_status(client):
    request_id = _create_outbound_request(client, "module-reject-req-001")

    reject_resp = client.post(
        f"/api/requests/{request_id}/reject",
        headers=HEADERS_ADMIN,
        json={"reason": "库存预留，暂不发放"},
    )
    assert reject_resp.status_code == 200
    rejected = reject_resp.json()["data"]
    assert rejected["status"] == "已拒绝"
    assert rejected.get("reject_reason") == "库存预留，暂不发放"

    mine_resp = client.get("/api/requests/mine", headers=HEADERS_USER)
    item = next(x for x in mine_resp.json()["data"] if x["id"] == request_id)
    assert item["status"] == "已拒绝"


def test_delete_pending_request_admin_only(client):
    request_id = _create_outbound_request(client, "module-delete-req-001")

    forbidden = client.delete(f"/api/admin/requests/{request_id}", headers=HEADERS_USER)
    assert forbidden.status_code == 403

    delete_resp = client.delete(f"/api/admin/requests/{request_id}", headers=HEADERS_ADMIN)
    assert delete_resp.status_code == 200
    assert delete_resp.json()["data"]["deleted"] is True

    pending = client.get("/api/requests?status=待审批", headers=HEADERS_ADMIN).json()["data"]
    assert not any(item["id"] == request_id for item in pending)


def test_admin_patch_request_remark(client):
    request_id = _create_outbound_request(client, "module-patch-req-001")

    patch_resp = client.patch(
        f"/api/admin/requests/{request_id}",
        headers=HEADERS_ADMIN,
        json={"remark": "管理员备注纠错"},
    )
    assert patch_resp.status_code == 200
    updated = patch_resp.json()["data"]
    assert "管理员备注纠错" in (updated.get("remark") or "")


def test_admin_patch_request_quantity(client):
    request_id = _create_outbound_request(client, "module-patch-qty-001")

    patch_resp = client.patch(
        f"/api/admin/requests/{request_id}",
        headers=HEADERS_ADMIN,
        json={"remark": "管理员备注纠错", "quantity": 2},
    )
    assert patch_resp.status_code == 200
    updated = patch_resp.json()["data"]
    assert updated["quantity"] == 2


def test_reject_request_forbidden_for_user(client):
    request_id = _create_outbound_request(client, "module-reject-deny-001")
    resp = client.post(
        f"/api/requests/{request_id}/reject",
        headers=HEADERS_USER,
        json={"reason": "无权限"},
    )
    assert resp.status_code == 403
