from __future__ import annotations

from app.utils.applicant import build_proxy_remark, resolve_subject_user
from app.models import Role, User


def test_resolve_subject_defaults_to_actor():
    actor = User(open_id="keeper", name="库管员", role=Role.KEEPER)
    oid, name = resolve_subject_user(actor, None, None, allow_proxy=True)
    assert oid == "keeper"
    assert name == "库管员"


def test_resolve_subject_proxy_when_allowed():
    actor = User(open_id="keeper", name="库管员", role=Role.KEEPER)
    oid, name = resolve_subject_user(actor, "user_zhang", "张工", allow_proxy=True)
    assert oid == "user_zhang"
    assert name == "张工"


def test_resolve_subject_proxy_forbidden_for_user():
    actor = User(open_id="user_a", name="研发用户", role=Role.USER)
    try:
        resolve_subject_user(actor, "user_b", "他人", allow_proxy=False)
        assert False, "expected ValueError"
    except ValueError as exc:
        assert str(exc) == "applicant_proxy_forbidden"


def test_build_proxy_remark_includes_applicant_and_operator():
    actor = User(open_id="keeper", name="库管员", role=Role.KEEPER)
    remark = build_proxy_remark("测试", actor, "user_zhang", subject_name="张工")
    assert remark is not None
    assert "申请人: 张工" in remark
    assert "操作人: 库管员" in remark
