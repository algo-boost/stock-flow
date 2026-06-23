from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    app_env: str = "dev"

    # 飞书
    feishu_app_id: str = ""
    feishu_app_secret: str = ""
    feishu_redirect_uri: str = ""

    @property
    def feishu_configured(self) -> bool:
        return bool(self.feishu_app_id and self.feishu_app_secret)

    # Bitable
    bitable_mode: str = "mock"  # mock | real
    bitable_app_token: str = ""
    bitable_table_categories: str = ""
    bitable_table_locations: str = ""
    bitable_table_materials: str = ""
    bitable_table_inventory: str = ""
    bitable_table_transactions: str = ""
    bitable_cache_ttl_seconds: int = 300

    @property
    def bitable_configured(self) -> bool:
        return bool(self.bitable_app_token)

    # 鉴权
    mock_auth_enabled: bool = True
    session_ttl_seconds: int = 86400

    # SQLite
    sqlite_cache_enabled: bool = True

    # 部署
    cors_origin_list: list[str] = ["*"]

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


@lru_cache
def get_settings() -> Settings:
    return Settings()
