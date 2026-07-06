from __future__ import annotations

from app.bitable.fields import append_operator_label, extract_person_label_from_remark, field_link_id, field_link_ids, field_number, is_feishu_user_id, normalize_tx_type, prepare_fields_for_bitable_write, resolve_person_name


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


def test_is_feishu_user_id():
    assert is_feishu_user_id("ou_abc1234567890") is True
    assert is_feishu_user_id("on_union123456789") is True
    assert is_feishu_user_id("h5_dev_user") is False
    assert is_feishu_user_id("ou_mock_dev_user") is False
    assert is_feishu_user_id("mock-local-user") is False
    assert is_feishu_user_id("") is False


def test_append_operator_label():
    assert append_operator_label(None, "管理员") == "操作人: 管理员"
    assert append_operator_label("测试", "管理员") == "测试；操作人: 管理员"
    assert append_operator_label("测试；操作人: 管理员", "管理员") == "测试；操作人: 管理员"


def test_extract_person_label_from_remark():
    assert extract_person_label_from_remark("测试；申请人: 研发用户", "申请人") == "研发用户"
    assert extract_person_label_from_remark("测试；操作人: 研发用户", "操作人") == "研发用户"
    assert extract_person_label_from_remark("测试；申请人: 研发用户", "操作人") is None


def test_resolve_person_name_from_remark():
    assert resolve_person_name(None, "测试；操作人: 研发用户", remark_prefix="操作人") == "研发用户"
    assert resolve_person_name([{"name": "杨忠银"}], "备注", remark_prefix="操作人") == "杨忠银"
    assert resolve_person_name([{"id": "ou_abc1234567890"}], "测试；操作人: 研发用户", remark_prefix="操作人") == "研发用户"
    assert (
        resolve_person_name(
            None,
            "测试；申请人: 研发用户；操作人: 未知",
            remark_prefix="操作人",
        )
        == "研发用户"
    )


def test_prepare_fields_for_bitable_write():
    raw = {
        "库存数量": "2",
        "行": 3,
        "列": 4,
        "物料ID": [{"record_ids": ["recMat"], "table_id": "tbl", "text": "1", "type": "text"}],
    }
    out = prepare_fields_for_bitable_write(raw)
    assert out["库存数量"] == 2
    assert out["行"] == 3
    assert out["物料ID"] == ["recMat"]
