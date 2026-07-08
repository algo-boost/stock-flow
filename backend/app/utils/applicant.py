from __future__ import annotations

from app.bitable.fields import append_operator_label
from app.models import User


def resolve_subject_user(
    actor: User,
    applicant_open_id: str | None,
    applicant_name: str | None,
    *,
    allow_proxy: bool,
) -> tuple[str, str]:
    """流水/申请的主体用户（领用人、归还人等）。"""
    if not applicant_open_id and not applicant_name:
        return actor.open_id, actor.name
    if not applicant_open_id or not applicant_name:
        raise ValueError("applicant_incomplete")
    if applicant_open_id == actor.open_id:
        return actor.open_id, actor.name
    if not allow_proxy:
        raise ValueError("applicant_proxy_forbidden")
    return applicant_open_id.strip(), applicant_name.strip()


def build_proxy_remark(
    remark: str | None,
    actor: User,
    subject_open_id: str,
    *,
    subject_name: str | None = None,
) -> str | None:
    """库管代操作时，在备注中记录借用人（申请人）与实际操作人。"""
    effective = remark or ""
    if subject_open_id != actor.open_id:
        if subject_name:
            effective = append_operator_label(effective, subject_name, prefix="申请人")
        effective = append_operator_label(effective, actor.name, prefix="操作人")
    return effective or None
