"""app.openapi() → backend/openapi.json. docs/README "계약의 강제" 1단계 — 라우트를 바꾸면 다시 돌린다."""

import json
from pathlib import Path

from app.main import create_app

out = Path(__file__).resolve().parent.parent / "openapi.json"
out.write_text(
    json.dumps(create_app().openapi(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
)
print(f"wrote {out}")
