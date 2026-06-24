"""物料目录与库存列表模块测试。"""

from __future__ import annotations

from tests.conftest import HEADERS_KEEPER, HEADERS_USER


def test_material_catalog_lists_items_with_inventory(client):
    resp = client.get("/api/materials/catalog", headers=HEADERS_USER)
    assert resp.status_code == 200
    items = resp.json()["data"]
    assert len(items) >= 1
    first = items[0]
    assert "material" in first
    assert "id" in first["material"] and "name" in first["material"]
    assert "inventory" in first or "total_quantity" in first


def test_material_catalog_search_and_stock_only(client):
    all_resp = client.get("/api/materials/catalog?q=大喵", headers=HEADERS_USER)
    assert all_resp.status_code == 200
    assert len(all_resp.json()["data"]) >= 1

    stock_resp = client.get("/api/materials/catalog?stock_only=true", headers=HEADERS_USER)
    assert stock_resp.status_code == 200
    for item in stock_resp.json()["data"]:
        qty = item.get("total_quantity", 0)
        assert qty > 0


def test_list_inventory_returns_all_slots(client):
    resp = client.get("/api/inventory", headers=HEADERS_KEEPER)
    assert resp.status_code == 200
    items = resp.json()["data"]
    assert len(items) >= 1
    assert all("material_id" in item and "location_id" in item for item in items)


def test_list_locations_includes_tree_nodes(client):
    resp = client.get("/api/locations", headers=HEADERS_USER)
    assert resp.status_code == 200
    locs = resp.json()["data"]
    ids = {item["id"] for item in locs}
    assert "loc_01" in ids
    assert any(item.get("parent_id") == "loc_01" for item in locs)
