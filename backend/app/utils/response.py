from typing import Any

from fastapi import HTTPException

from app.models import ApiResponse


class AppError(Exception):
    def __init__(self, code: int, message: str, status_code: int = 400):
        self.code = code
        self.message = message
        self.status_code = status_code
        super().__init__(message)


def success(data: Any = None, message: str = "ok") -> dict[str, Any]:
    return ApiResponse(code=0, message=message, data=data).model_dump()


def app_error_handler(_request: Any, exc: AppError) -> ApiResponse:
    return ApiResponse(code=exc.code, message=exc.message, data=None)


def http_exception_to_app(exc: HTTPException) -> ApiResponse:
    code = exc.status_code
    if exc.status_code == 403:
        code = 2001
    return ApiResponse(code=code, message=str(exc.detail), data=None)
