import type { DocComment, DocSummary, DocVersion } from '@/features/docs/types'
import type { User } from '@/types'

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString()
}

/**
 * 문서 메타. 본문은 여기 없다 — Y.Doc(IndexedDB)에 있다.
 *
 * 실제 서버도 같은 모양이 된다. 본문은 Yjs 업데이트로 보관하고, 목록·검색용
 * 제목과 수정시각만 별도 테이블에 투영해 둔다.
 */
export const DOCS: DocSummary[] = [
  {
    id: 'd-1',
    title: '2026 하반기 제품 로드맵',
    updatedAt: minutesAgo(12),
    editorName: '박동현',
    editorHue: 155,
  },
  {
    id: 'd-2',
    title: '근태 모듈 설계서 v0.3 리뷰 노트',
    updatedAt: minutesAgo(95),
    editorName: '김수진',
    editorHue: 275,
  },
  {
    id: 'd-3',
    title: '주간 개발 회의록 (8월 4주차)',
    updatedAt: minutesAgo(300),
    editorName: '이정민',
    editorHue: 200,
  },
  {
    id: 'd-4',
    title: 'RAG 권한 필터 설계 메모',
    updatedAt: minutesAgo(1500),
    editorName: '한지우',
    editorHue: 95,
  },
  {
    id: 'd-5',
    title: '휴가·연차 정책 확인 메모',
    updatedAt: minutesAgo(2900),
    editorName: '김수진',
    editorHue: 275,
  },
]

/** Y.Doc이 비어 있을 때만 한 번 심는 초안. */
export const DOC_SEEDS: Record<string, string> = {
  'd-1': `
    <h2>목표</h2>
    <p>흩어진 업무 대화와 문서를 사내 서버 하나로 모은다. 외부 SaaS 구독과 데이터 유출 경로를 함께 없앤다.</p>
    <h2>마일스톤</h2>
    <ul>
      <li><strong>M1 코어</strong> — 인증, 문서 CRUD, 실시간 공동편집, 댓글</li>
      <li><strong>M2 커뮤니케이션</strong> — 채팅, 알림, 홈 대시보드, 통합검색</li>
      <li><strong>M3 AI</strong> — 로컬 LLM, 위키 RAG, 인라인 AI</li>
      <li><strong>M4 마감</strong> — 등급별 게시판, 앱 패키징, 파일럿</li>
    </ul>
    <blockquote><p>근태는 아직 로드맵에 자리가 없다. 순개발량 약 14일 추정.</p></blockquote>
  `,
  'd-2': `
    <p>설계서 v0.3에서 바뀐 전제를 정리한다.</p>
    <h2>출퇴근 시각을 기록하지 않는다</h2>
    <p>출입 단말을 연동하지 않고 앱 출퇴근 버튼도 두지 않는다. 전 직원이 <strong>주 5일 09~18시 고정 근무</strong>이므로 평일의 기본 상태는 "정상 근무 8시간"이라는 상수다.</p>
    <p>그래서 근태가 기록하는 것은 예외뿐이다 — 휴가·재택·외근·출장·연장근로를 신청하고 팀장이 승인한다.</p>
    <h2>확인이 필요한 것</h2>
    <ol>
      <li>실근로시간을 기록하지 않으면 주 52시간을 명목값으로만 볼 수 있음 — 노무사 확인 필요</li>
      <li>취업규칙상 시업·종업 시각이 09~18시와 맞는지</li>
      <li>팀 개념이 없어 lead의 조회 범위를 정할 수 없음 — teams 테이블 선행 필요</li>
    </ol>
  `,
  'd-3': `
    <h2>진행 상황</h2>
    <ul>
      <li>프론트엔드 스캐폴딩 완료. 앱 셸과 홈 대시보드 동작</li>
      <li>백엔드 미착수 — 목 API로 선행 개발 중</li>
    </ul>
    <h2>논의</h2>
    <p>Yjs 커서 동기화에서 간헐적 이슈. 재현 조건 확인 필요.</p>
    <h2>다음 주</h2>
    <p>문서 모듈 에디터, FastAPI 인증 엔드포인트.</p>
  `,
  'd-4': `
    <p>RAG 답변에 권한 밖 문서가 근거로 섞이면 안 된다.</p>
    <h2>접근</h2>
    <p>벡터 검색 <em>이후</em>가 아니라 <em>이전</em>에 거른다. 검색 쿼리에 사용자의 열람 가능 문서 ID를 조건으로 넣는다.</p>
    <p>검색 후 필터링은 top-k가 권한 밖 문서로 채워지면 답변 품질이 무너진다.</p>
  `,
  'd-5': `
    <p>연차 산정을 붙이기 전에 인사 확인이 필요한 항목들.</p>
    <ul>
      <li>부여 기준 — 입사일 기준인가, 회계연도(1/1) 일괄인가</li>
      <li>반차 운영 단위 — 오전/오후 반차만인가, 시간 단위도 쓰는가</li>
      <li>결근 확정 절차 — 누가 언제 입력하는가 (출근율·연차에 직결)</li>
    </ul>
    <p>부여 기준이 정해져야 <code>leave_balances.grant_basis</code>의 기본값을 잡을 수 있다.</p>
  `,
}

const comments: Record<string, DocComment[]> = {
  'd-2': [
    {
      id: 'cm-1',
      authorId: 'u-2',
      authorName: '박동현',
      authorHue: 155,
      body: '퇴근 미기록을 결근으로 보지 않는다는 부분, 노무사 검토 때 꼭 짚어야 합니다.',
      createdAt: minutesAgo(240),
    },
    {
      id: 'cm-2',
      authorId: 'u-1',
      authorName: '김수진',
      authorHue: 275,
      body: '동의합니다. 홈 위젯에도 "미확정"으로 표기하도록 반영해 뒀어요.',
      createdAt: minutesAgo(180),
    },
  ],
}

let nextId = 100

export function listDocs(query: string): DocSummary[] {
  const q = query.trim().toLowerCase()
  const matched = q ? DOCS.filter((doc) => doc.title.toLowerCase().includes(q)) : DOCS
  return [...matched].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export function findDoc(id: string): DocSummary | undefined {
  return DOCS.find((doc) => doc.id === id)
}

export function createDoc(user: User): DocSummary {
  const doc: DocSummary = {
    id: `d-${nextId++}`,
    title: '제목 없는 문서',
    updatedAt: new Date().toISOString(),
    editorName: user.name,
    editorHue: user.avatarHue,
  }
  DOCS.unshift(doc)
  return doc
}

/** 제목의 원천은 Y.Doc이다. 여기 반영하는 건 목록·검색용 투영일 뿐이다. */
export function touchDoc(id: string, user: User, title?: string): DocSummary | undefined {
  const doc = findDoc(id)
  if (!doc) return undefined
  if (title !== undefined) doc.title = title
  doc.updatedAt = new Date().toISOString()
  doc.editorName = user.name
  doc.editorHue = user.avatarHue
  return doc
}

// ── 버전 기록 ────────────────────────────────────────────────

const versions: Record<string, DocVersion[]> = {}

/**
 * 같은 사람이 이어서 편집하는 동안 생기는 스냅샷을 하나로 접는 시간.
 * 접지 않으면 타이핑을 멈출 때마다 버전이 쌓여 기록을 읽을 수 없게 된다.
 */
const COALESCE_MS = 3 * 60_000

/** 최신순. */
export function listVersions(docId: string): DocVersion[] {
  return [...(versions[docId] ?? [])].reverse()
}

export function addVersion(
  docId: string,
  user: User,
  snapshot: string,
  label?: string,
): DocVersion {
  const history = (versions[docId] ??= [])
  const latest = history.at(-1)

  const version: DocVersion = {
    id: `v-${nextId++}`,
    createdAt: new Date().toISOString(),
    authorId: user.id,
    authorName: user.name,
    authorHue: user.avatarHue,
    snapshot,
    label,
  }

  // 같은 사람이 방금 남긴 무명 버전이면 새로 쌓지 않고 갱신한다.
  const coalescable =
    latest !== undefined &&
    !label &&
    !latest.label &&
    latest.authorId === user.id &&
    Date.now() - new Date(latest.createdAt).getTime() < COALESCE_MS

  if (coalescable) {
    history[history.length - 1] = { ...version, id: latest.id }
    return history[history.length - 1]
  }

  history.push(version)
  return version
}

export function listComments(docId: string): DocComment[] {
  return comments[docId] ?? []
}

export function addComment(docId: string, user: User, body: string): DocComment {
  const comment: DocComment = {
    id: `cm-${nextId++}`,
    authorId: user.id,
    authorName: user.name,
    authorHue: user.avatarHue,
    body,
    createdAt: new Date().toISOString(),
  }
  comments[docId] = [...(comments[docId] ?? []), comment]
  return comment
}
