# 제니스(Zenith) — 협업 규칙

> 사내 협업툴(채팅·문서·게시판·AI·근태·전자결재), 온프레미스, ~15명. 개요는 [README](README.md),
> **정본은 Notion** — 어떤 문서를 언제 여는지는 [docs/README.md](docs/README.md). 레포에 문서 사본을 두지 않는다.

## 역할 분담 (작업자 2인)

이 파일은 양쪽이 공유한다. 아래는 **영역 기준**이고, 각 담당(과 각자의 Claude)은 자기 영역만 직접 수정한다.

| 영역 | 담당 | 경로 | 영역 규칙 |
| --- | --- | --- | --- |
| 백엔드 | 정성운 + Claude | `backend/` · `infra/` · `.github/` · 루트 설정 | [backend/CLAUDE.md](backend/CLAUDE.md) |
| 프론트 | 진수연 + Claude | `frontend/` · `apps/` | [frontend/CLAUDE.md](frontend/CLAUDE.md) · [apps/desktop/CLAUDE.md](apps/desktop/CLAUDE.md) |

- 상대 영역은 **직접 수정하지 않는다** — 제안·PR 코멘트로만. `docs/`·루트 README 는 공용(둘 다 고칠 수 있음).
- 영역 규칙 파일은 그 디렉터리에서 작업할 때 자동으로 로드된다. 여기에는 공통만 둔다.

## 협업 워크플로 (main 트렁크)

- **`main` 하나가 트렁크.** 작업 시작 전 `git checkout main && git pull`. 짧은 브랜치 → PR → `ci-ok` green → **squash 머지** → 브랜치 삭제.
- 브랜치명: 백엔드 `feat/be-*`·`fix/be-*`, 프론트 `feat/fe-*`·`fix/fe-*`, 공용 `docs/*`·`chore/*`.
- **`main` 직접 push 금지.** `.claude/settings.json` 훅(`.claude/hooks/block-main-push.mjs`)이 도구 실행 전에 차단한다. 우회하지 말고 PR 로.
- 인간 상호 코드리뷰는 안 한다(서로 도메인을 모름). 각자 Claude 로 리뷰하고 self-merge. PR 승인 요구 0.
- CI(`.github/workflows/ci.yml`)는 path 필터로 백엔드·프론트 잡을 분리하고 게이트 `ci-ok` 하나만 required. 백엔드 PR 은 프론트 빌드를, 프론트 PR 은 백엔드 테스트를 기다리지 않는다.
- 배포 브랜치(`prod`)는 파일럿 배포 시점에 만든다. 그때까지 버전은 `0.1.0` 고정, 태그 없음.

## FE↔BE 계약

- 심판은 [04 · API 명세서](docs/README.md). 기계 판독본은 **`backend/openapi.json`**(커밋됨, `backend/tests/test_contract.py` 가 최신성 검사).
- 엔드포인트·요청/응답 스키마·에러 코드가 바뀌는 PR 은 **본문에 명시하고 상대에게 공유**한다.
- 04 에 없는 것을 만들면 `backend/README.md` "설계와 어긋나는 것"에 적는다. Notion 을 고치기 전까지 그 목록이 차이의 단일 출처다.
- 설계 결정이 코드 변경을 부르면 **PR 본문에 Notion 문서 번호와 절(§)** 을 적는다. 레포에서 설계 근거를 추적하는 경로는 이것 하나다.

## 커밋

- Conventional commit, **한국어**: `type(scope): 요약`. type = feat·fix·refactor·docs·test·chore. scope = 영역(`backend`·`frontend`·`desktop`·`infra`) 또는 기능(`auth`·`docs`·`chat`·`board`·`approval`·`attendance`·`ai`).
- 본문에는 무엇을·왜. "리뷰 후속" 커밋은 어떤 리뷰 지적을 반영했는지 한 줄씩.
- 트레일러: `Co-Authored-By: Claude <모델명> <noreply@anthropic.com>` — 모델명은 세션이 알려 주는 현재 모델. 세션 URL 트레일러(`Claude-Session:`)도 주어지면 그대로 붙인다.
- **커밋 전 영역 로컬 게이트 green** (각 영역 CLAUDE.md 의 "게이트"). 게이트를 건너뛴 커밋은 CI 에서 걸린다.

## 기본 동작

- **기능은 하나씩, 깊게.** 한 턴에 여러 모듈을 벌리지 않는다. 기능마다 정본 절 읽기 → 구현 → 테스트 → 리뷰 → 커밋까지 닫은 뒤 다음 기능.
- **소~중형**(버그픽스·옵션·멀티파일 수정) → 구현 + Claude 리뷰어 1회(`code-reviewer` 계열).
- **대형/보안민감** → 적대적 리뷰 2회. 보안민감 = 인증·세션·CSRF·권한 판정(등급 게시판·결재 열람)·관리자 경로·마이그레이션·신뢰불가 입력 파싱·AI 프롬프트에 들어가는 사용자 데이터. 백엔드는 아래 Codex 교차검증으로 두 번째 리뷰를 수행한다.
- 범위가 애매하면 한 번 묻고, 합리적이면 추정을 명시하고 진행한다. 검증·안전·명시된 범위는 축소하지 않는다.
- 주석·커밋·PR 본문·리뷰 결과는 한국어.

## 안전 가드레일

- `.env*` 커밋 금지(`.env.example` 만). 시크릿·키·인증서는 레포 밖.
- **데이터·AI 추론이 사내망 밖으로 나가지 않는다**(README 성공 기준). 프론트 CDN 금지, 백엔드 외부 호출은 AI 공급자(Claude API, 2026-09-04 결정) 하나뿐이며 `app/ai/provider.py` 경계 뒤에 둔다.
- 권한은 UI 가 아니라 서버가 판정한다. 프론트의 메뉴 숨김·마스킹은 편의일 뿐, 실제 차단은 API 의 403.
- 데이터를 지우거나 스키마를 되돌리는 마이그레이션·스크립트는 실행 전에 사람 확인.

## Codex 교차검증 *(백엔드 전용)*

Claude Code(메인) = 기획·구현·테스트 → Codex = 독립 리뷰(파일 수정 금지, 적용은 메인이).

- **대상**: 위 "대형/보안민감"에 해당하는 백엔드 변경. 소~중형은 Claude 리뷰어 1회로 끝낸다.
- **방법**: `codex-reviewer` 에이전트(`.claude/agents/`)와 Claude 리뷰어를 **병렬**로 돌리고, 메인 세션이 종합(중복 병합·심각도 조정·채택/기각)한다.
- Codex 모델은 `gpt-5.6-sol`. 호출은 codex MCP(`.mcp.json`) 우선, 미가용 시 `codex exec` 폴백. Codex 왕복 실패는 결과에 **"Codex 미가동"** 으로 명시한다 — 교차검증 안 된 결과를 숨기지 않는다.
- 프론트 PR 은 Codex 를 쓰지 않는다(프론트 PC 에 codex CLI 전제 없음).
