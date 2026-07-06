from __future__ import annotations

MOCK_DIRECTORY_USERS: list[dict[str, str]] = [
    {"open_id": "user_zhang", "name": "张工"},
    {"open_id": "user_li", "name": "李工"},
    {"open_id": "user_wang", "name": "王工"},
    {"open_id": "mock-local-user", "name": "研发用户"},
    {"open_id": "mock-keeper", "name": "库管员"},
    {"open_id": "mock-admin", "name": "管理员"},
]


def search_mock_directory_users(query: str = "", *, limit: int = 20) -> list[dict[str, str]]:
    items = list(MOCK_DIRECTORY_USERS)
    q = query.strip().lower()
    if q:
        items = [item for item in items if q in item["name"].lower() or q in item["open_id"].lower()]
    return items[: max(1, min(limit, 50))]
