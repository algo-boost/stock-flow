"""认证与启动模块：/me、/bootstrap、角色权限。"""

from __future__ import annotations

from tests.conftest import HEADERS_ADMIN, HEADERS_KEEPER, HEADERS_USER


def test_me_returns_role_for_all_roles(client):
    for headers, role in [
        (HEADERS_USER, "USER"),
        (HEADERS_KEEPER, "KEEPER"),
        (HEADERS_ADMIN, "ADMIN"),
    ]:
        resp = client.get("/api/me", headers=headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["code"] == 0
        assert body["data"]["user"]["role"] == role


def test_bootstrap_returns_categories_materials_locations(client):
    resp = client.get("/api/bootstrap", headers=HEADERS_USER)
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert isinstance(data["categories"], list) and len(data["categories"]) >= 1
    assert isinstance(data["materials"], list) and len(data["materials"]) >= 1
    assert isinstance(data["locations"], list) and len(data["locations"]) >= 1
    first_material = data["materials"][0]
    assert "material" in first_material
    assert "name" in first_material["material"]
    assert "inventory" in first_material or "total_quantity" in first_material


def test_health_reports_mock_mode(client):
    resp = client.get("/api/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["bitable_mode"] == "mock"
    assert body["mock_auth_enabled"] is True
