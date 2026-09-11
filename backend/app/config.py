"""환경 설정. 값의 출처: ARCHITECTURE §7(compose env) · 04-API §1(토큰 수명) · 11 §7.2(쿠키)."""

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://zenith:zenith@localhost:5432/zenith"
    # ponytail: Redis(presence·PubSub)는 아직 코드가 쓰지 않는다. compose와 짝을 맞춘 자리만 둔다.
    redis_url: str = "redis://localhost:6379/0"
    # MinIO — 채팅 첨부(app/storage.py). 브라우저는 여기 직접 붙지 않는다.
    minio_endpoint: str = "localhost:9000"
    minio_access_key: str = "zenith"
    minio_secret_key: str = "zenith-minio"
    minio_bucket: str = "zenith"

    # 기본값이 없다 — 알려진 키로 토큰을 서명하느니 안 뜨는 게 낫다. HS256 최소 32바이트(RFC 7518 §3.2).
    jwt_secret: str = Field(min_length=32)
    access_ttl_minutes: int = 15  # 04-API §1
    refresh_ttl_days: int = 14  # 04-API §1
    cookie_secure: bool = True  # 11 §7.2 — 로컬 http 개발에서만 False
    # 이 시간 안에 같은 이메일로 이만큼, 또는 같은 IP 로 이만큼 실패하면 429.
    # 감사 로그(auth.login_fail)를 세므로 별도 저장소가 없다. IP 기준은 이메일을 바꿔 가며 두드리는 걸 막는다.
    login_max_failures: int = 10
    login_max_failures_per_ip: int = 30
    login_failure_window_minutes: int = 15
    password_min_length: int = 8

    # 비우면 SDK가 ANTHROPIC_API_KEY / `ant auth` 프로필을 찾는다.
    anthropic_api_key: str | None = None
    ai_model: str = "claude-opus-5"
    ai_max_tokens: int = 64000

    cors_origins: list[str] = []


settings = Settings()
