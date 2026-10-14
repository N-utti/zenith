"""환경 설정. 값의 출처: ARCHITECTURE §7(compose env) · 04-API §1(토큰 수명) · 11 §7.2(쿠키)."""

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://zenith:zenith@127.0.0.1:5432/zenith"
    # ponytail: Redis(presence·PubSub)는 아직 코드가 쓰지 않는다. compose와 짝을 맞춘 자리만 둔다.
    redis_url: str = "redis://127.0.0.1:6379/0"
    # MinIO — 채팅 첨부(app/storage.py). 브라우저는 여기 직접 붙지 않는다.
    minio_endpoint: str = "127.0.0.1:9000"
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
    # 벡터 검색(README 45) — Ollama 의 `/api/embed`(bge-m3). 비우면 색인·벡터 검색이 꺼지고 핵심어(FTS)만 쓴다
    # (CI·개발 PC 는 꺼진 채로 돈다). compose 는 `http://ollama:11434`.
    embed_url: str | None = None
    embed_model: str = "bge-m3:567m"  # 태그 고정 — latest 가 바뀌어 차원이 달라지지 않게
    # 규정 폴더(README 46) — 있으면 그 폴더(하위 포함)의 「AI 근거로 쓰기」 문서 전문을 질문마다 시스템 프롬프트에
    # 넣는다(프롬프트 캐시). 비면 검색 도구만. 전문 합이 ai_rules_max_chars 를 넘으면 넣지 않고 경고만(검색으로 폴백).
    ai_rules_folder: str | None = None
    ai_rules_max_chars: int = (
        150_000  # ≈9만 토큰 — ai_max_tokens(64k)와 합쳐 문맥 창(20만) 안(보안 리뷰)
    )
    # 팩트체커 웹 검색(README 49) — 배포 스위치. 켜도 요청이 `web: true` 를 보낼 때만 Claude 서버측 web_search 를 붙인다.
    # 검사 대상 글이 검색어가 되어 웹에 닿는다(사내망 밖) — 루트 README 가드레일 참조.
    ai_web_search: bool = False
    ai_doc_max_chars: int = 50_000  # `doc:` 범위 문서 본문 상한 — 넘으면 앞만 넣고 모델에게 알린다

    cors_origins: list[str] = []


settings = Settings()
