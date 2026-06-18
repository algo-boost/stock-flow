from __future__ import annotations

from app.bitable.fields import field_link_id, field_link_ids, field_number, normalize_tx_type


def test_field_link_ids_feishu_record_ids_format():
    value = [
        {
            "record_ids": ["rech86lXA7hy0R"],
            "table_id": "tblbEl3gsrHIRONA",
            "text": "12",
            "type": "text",
        }
    ]
    assert field_link_ids(value) == ["rech86lXA7hy0R"]
    assert field_link_id(value) == "rech86lXA7hy0R"


def test_field_number_parses_string_quantity():
    assert field_number("100") == 100
    assert field_number("15.0") == 15


def test_normalize_tx_type():
    assert normalize_tx_type("in") == "入库"
    assert normalize_tx_type("out") == "出库"
