import type {
  DocComment,
  DocSummary,
  DocTreeData,
  DocVersion,
  DocVersionSnapshot,
  Folder,
} from '@/features/docs/types'
import type { RecentDoc } from '@/features/home/types'
import type { User } from '@/types'
import { uuid } from '@/features/ai/store'

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString()
}

/**
 * 폴더. 문서는 폴더에만 담긴다(문서끼리 겹치지 않는다).
 *
 * 실제 서버도 같은 모양이다. `sort` 는 같은 부모 안에서의 순서이고 작은 것이 위다.
 */
export const FOLDERS: Folder[] = [
  { id: 'f-1', parent_id: null, title: '회사 위키', sort: 0 },
  { id: 'f-2', parent_id: null, title: '회의록', sort: 1 },
  { id: 'f-3', parent_id: 'f-1', title: '제품', sort: 0 },
  { id: 'f-4', parent_id: null, title: '주간 업무보고', sort: 2 },
]

/**
 * 문서 메타. 본문은 여기 없다: Y.Doc(IndexedDB)에 있다.
 *
 * 실제 서버도 같은 모양이 된다. 본문은 Yjs 업데이트로 보관하고, 목록·검색용
 * 제목과 수정시각만 별도 테이블에 투영해 둔다.
 */
export const DOCS: DocSummary[] = [
  {
    id: 'd-0',
    folder_id: 'f-1',
    title: '온보딩 안내',
    updated_at: minutesAgo(40),
    updated_by: { id: 'u-2', name: '정성운' },
    deleted_at: null,
  },
  {
    id: 'd-1',
    folder_id: 'f-3',
    title: '2026 하반기 제품 로드맵',
    updated_at: minutesAgo(12),
    updated_by: { id: 'u-2', name: '정성운' },
    deleted_at: null,
  },
  {
    id: 'd-2',
    folder_id: 'f-2',
    title: '근태 모듈 설계서 v0.3 리뷰 노트',
    updated_at: minutesAgo(95),
    updated_by: { id: 'u-1', name: '진수연' },
    deleted_at: null,
  },
  {
    id: 'd-3',
    folder_id: 'f-2',
    title: '주간 개발 회의록 (8월 4주차)',
    updated_at: minutesAgo(300),
    updated_by: { id: 'u-4', name: '장지윤' },
    deleted_at: null,
  },
  {
    id: 'd-4',
    folder_id: 'f-3',
    title: 'RAG 권한 필터 설계 메모',
    updated_at: minutesAgo(1500),
    updated_by: { id: 'u-7', name: '김혜리' },
    deleted_at: null,
  },
  {
    id: 'd-5',
    folder_id: 'f-1',
    title: '휴가·연차 정책 확인 메모',
    updated_at: minutesAgo(2900),
    updated_by: { id: 'u-1', name: '진수연' },
    deleted_at: null,
  },
  {
    id: 'd-6',
    folder_id: 'f-4',
    title: '주간 업무보고 (9월 5주차)',
    updated_at: minutesAgo(60),
    updated_by: { id: 'u-8', name: '성예림' },
    deleted_at: null,
  },
  // 지난주들. 사이드바는 폴더마다 최근 5개만 펼친다(DocTree `PREVIEW_DOCS`). 넘치는 모양을 보려고 둔다.
  {
    id: 'd-7',
    folder_id: 'f-4',
    title: '주간 업무보고 (9월 4주차)',
    updated_at: minutesAgo(7 * 1440),
    updated_by: { id: 'u-8', name: '성예림' },
    deleted_at: null,
  },
  {
    id: 'd-8',
    folder_id: 'f-4',
    title: '주간 업무보고 (9월 3주차)',
    updated_at: minutesAgo(14 * 1440),
    updated_by: { id: 'u-8', name: '성예림' },
    deleted_at: null,
  },
  {
    id: 'd-9',
    folder_id: 'f-4',
    title: '주간 업무보고 (9월 2주차)',
    updated_at: minutesAgo(21 * 1440),
    updated_by: { id: 'u-8', name: '성예림' },
    deleted_at: null,
  },
  {
    id: 'd-10',
    folder_id: 'f-4',
    title: '주간 업무보고 (9월 1주차)',
    updated_at: minutesAgo(28 * 1440),
    updated_by: { id: 'u-8', name: '성예림' },
    deleted_at: null,
  },
  {
    id: 'd-11',
    folder_id: 'f-4',
    title: '주간 업무보고 (8월 5주차)',
    updated_at: minutesAgo(35 * 1440),
    updated_by: { id: 'u-8', name: '성예림' },
    deleted_at: null,
  },
]

/** Y.Doc이 비어 있을 때만 한 번 심는 초안. */
export const DOC_SEEDS: Record<string, string> = {
  'd-1': `
    <h2>목표</h2>
    <p>흩어진 업무 대화와 문서를 사내 서버 하나로 모은다. 외부 SaaS 구독과 데이터 유출 경로를 함께 없앤다.</p>
    <h2>마일스톤</h2>
    <ul>
      <li><strong>M1 코어</strong>: 인증, 문서 CRUD, 실시간 공동편집, 댓글</li>
      <li><strong>M2 커뮤니케이션</strong>: 채팅, 알림, 홈 대시보드, 통합검색</li>
      <li><strong>M3 AI</strong>: 로컬 LLM, 위키 RAG, 인라인 AI</li>
      <li><strong>M4 마감</strong>: 등급별 게시판, 앱 패키징, 파일럿</li>
    </ul>
    <blockquote><p>근태는 아직 로드맵에 자리가 없다. 순개발량 약 14일 추정.</p></blockquote>
  `,
  'd-2': `
    <p>설계서 v0.3에서 바뀐 전제를 정리한다.</p>
    <h2>출퇴근 시각을 기록하지 않는다</h2>
    <p>출입 단말을 연동하지 않고 앱 출퇴근 버튼도 두지 않는다. 전 직원이 <strong>주 5일 09~18시 고정 근무</strong>이므로 평일의 기본 상태는 "정상 근무 8시간"이라는 상수다.</p>
    <p>그래서 근태가 기록하는 것은 예외뿐이다: 휴가·재택·외근·출장·연장근로를 신청하고 팀장이 승인한다.</p>
    <h2>확인이 필요한 것</h2>
    <ol>
      <li>실근로시간을 기록하지 않으면 주 52시간을 명목값으로만 볼 수 있음: 노무사 확인 필요</li>
      <li>취업규칙상 시업·종업 시각이 09~18시와 맞는지</li>
      <li>팀 개념이 없어 lead의 조회 범위를 정할 수 없음: teams 테이블 선행 필요</li>
    </ol>
  `,
  'd-3': `
    <h2>진행 상황</h2>
    <ul>
      <li>프론트엔드 스캐폴딩 완료. 앱 셸과 홈 대시보드 동작</li>
      <li>백엔드 미착수: 목 API로 선행 개발 중</li>
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
      <li>부여 기준: 입사일 기준인가, 회계연도(1/1) 일괄인가</li>
      <li>반차 운영 단위: 오전/오후 반차만인가, 시간 단위도 쓰는가</li>
      <li>결근 확정 절차: 누가 언제 입력하는가 (출근율·연차에 직결)</li>
    </ul>
    <p>부여 기준이 정해져야 <code>leave_balances.grant_basis</code>의 기본값을 잡을 수 있다.</p>
  `,
  // 문서 안 AI 의 "주간 보고" 템플릿(templateBlocks.ts)과 같은 칸의 표를 채운 모양. 빈 줄은 사람 수만큼 줄였다.
  'd-6': `
    <h2>업무 현황</h2>
    <table><tbody>
      <tr><th>부서명</th><th>전주 진행 완료 사항</th><th>금주 진행 예정 사항</th><th>예정 완료 기한</th><th>요청사항</th></tr>
      <tr><td>회계팀 성예림</td><td>1. 금감원 CPC 지원 보고<br>2. 직원 필수교육(자금세탁방지교육) 자료 찾기</td><td>1. 통장 정리 후 회계사무실 전달<br>2. 재무제표 완료되는 대로 월·분기 보고서 금감원 제출<br>3. 분기 보고서 홈페이지 게시<br>4. 급여대장 작성 및 회계사무실 전달</td><td>10/6<br>10/12<br>10/12<br>10/6</td><td></td></tr>
      <tr><td>펀드팀 김다인</td><td></td><td></td><td></td><td></td></tr>
      <tr><td>펀드팀 안재호</td><td></td><td></td><td></td><td></td></tr>
      <tr><td>디지털 리서치팀</td><td></td><td></td><td></td><td></td></tr>
      <tr><td>인프라 유치팀</td><td></td><td></td><td></td><td></td></tr>
    </tbody></table>
  `,
}

const comments: Record<string, DocComment[]> = {
  // 멘션 알림 목(notificationsDb n-1·n-4)이 가리키는 댓글. 알림을 누르면 이 댓글로 간다.
  'd-1': [
    {
      id: 'dc-1',
      block_id: null,
      author: { id: 'u-2', name: '정성운' },
      body: '예산 표에 근거 자료 링크 걸어주세요 @김철성',
      created_at: minutesAgo(34),
    },
  ],
  'd-3': [
    {
      id: 'dc-2',
      block_id: null,
      author: { id: 'u-1', name: '진수연' },
      body: '회의록에 결정사항 정리해 뒀습니다 @정성운',
      created_at: minutesAgo(1400),
    },
  ],
  'd-2': [
    {
      id: 'cm-1',
      block_id: null,
      author: { id: 'u-2', name: '정성운' },
      body: '퇴근 미기록을 결근으로 보지 않는다는 부분, 노무사 검토 때 꼭 짚어야 합니다.',
      created_at: minutesAgo(240),
    },
    {
      id: 'cm-2',
      block_id: null,
      author: { id: 'u-1', name: '진수연' },
      body: '동의합니다. 홈 위젯에도 "미확정"으로 표기하도록 반영해 뒀어요.',
      created_at: minutesAgo(180),
    },
  ],
}

let nextId = 100

export function listDocs(query: string): DocSummary[] {
  const q = query.trim().toLowerCase()
  const alive = DOCS.filter((doc) => !doc.deleted_at)
  const matched = q ? alive.filter((doc) => doc.title.toLowerCase().includes(q)) : alive
  return [...matched].sort((a, b) => b.updated_at.localeCompare(a.updated_at))
}

/**
 * 휴지통(`GET /trash`). 지운 지 최근 순, 같은 시각이면 id 순. 서버와 같은 정렬이다.
 * 살아 있는 문서 목록(`/tree`·`/docs`)의 여집합이라 겹치지 않는다.
 */
export function listTrash(limit: number): DocSummary[] {
  return DOCS.filter((doc) => doc.deleted_at)
    .sort(
      (a, b) => (b.deleted_at ?? '').localeCompare(a.deleted_at ?? '') || a.id.localeCompare(b.id),
    )
    .slice(0, limit)
}

/**
 * 홈의 "이어서 작업". 백엔드 `RecentDoc` 과 같은 모양이다. 문서 목록의 `DocSummary` 와 달리
 * 폴더 경로(`path`)가 실려 있다.
 */
export function recentDocs(user: User, limit: number): RecentDoc[] {
  const alive = listDocs('')
  // 내가 마지막으로 손댄 문서가 먼저다. 하나도 없으면(신입) 전사 최근으로 채운다.
  const mine = alive.filter((doc) => doc.updated_by?.id === user.id)
  return (mine.length > 0 ? mine : alive).slice(0, limit).map((doc) => ({
    id: doc.id,
    title: doc.title,
    path: folderPath(doc.folder_id),
    updated_at: doc.updated_at,
    updated_by: doc.updated_by,
  }))
}

/** 최상위부터의 폴더 이름. 고리가 있어도 멈춘다. */
function folderPath(folderId: string): string[] {
  const names: string[] = []
  const seen = new Set<string>()
  let current = findFolder(folderId)
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    names.unshift(current.title)
    current = current.parent_id ? findFolder(current.parent_id) : undefined
  }
  return names
}

/** 사이드바 트리 한 벌. 휴지통에 든 문서는 빼고 준다. */
export function docTree(): DocTreeData {
  return { folders: [...FOLDERS], docs: DOCS.filter((doc) => !doc.deleted_at) }
}

export function findFolder(id: string): Folder | undefined {
  return FOLDERS.find((folder) => folder.id === id)
}

export function createFolder(input: {
  title: string
  parent_id?: string | null
  sort?: number
}): Folder {
  const folder: Folder = {
    id: `f-${uuid()}`,
    parent_id: input.parent_id ?? null,
    title: input.title,
    sort: input.sort ?? 0,
  }
  FOLDERS.push(folder)
  return folder
}

export function updateFolder(
  folder: Folder,
  input: { title?: string; parent_id?: string | null; sort?: number },
): Folder {
  if (input.title !== undefined) folder.title = input.title
  if (input.parent_id !== undefined) folder.parent_id = input.parent_id
  if (input.sort !== undefined) folder.sort = input.sort
  return folder
}

/**
 * 폴더를 지운다. **비어 있어야 한다.** 못 지우면 이유를, 지웠으면 `null` 을 돌려준다.
 *
 * 휴지통에 든 문서도 그 폴더의 것이다. 폴더가 없어지면 되살릴 자리가 없다(문서는 폴더 안에만
 * 있을 수 있다). 트리에는 안 보이므로 이유를 따로 가른다.
 * 서버에는 아직 없는 경로다(`handlers.ts` 의 주석).
 */
export function removeFolder(folder: Folder): 'not_empty' | 'has_trashed' | null {
  const inside = DOCS.filter((doc) => doc.folder_id === folder.id)
  if (FOLDERS.some((f) => f.parent_id === folder.id) || inside.some((doc) => !doc.deleted_at)) {
    return 'not_empty'
  }
  if (inside.length > 0) return 'has_trashed'
  FOLDERS.splice(FOLDERS.indexOf(folder), 1)
  return null
}

/** 폴더를 자기 자손 아래로 옮기면 트리에서 통째로 사라진다. 서버도 막는 자리다. */
export function isDescendantFolder(folderId: string, maybeAncestorId: string): boolean {
  const seen = new Set<string>()
  let current = findFolder(folderId)
  while (current && !seen.has(current.id)) {
    if (current.id === maybeAncestorId) return true
    seen.add(current.id)
    current = current.parent_id ? findFolder(current.parent_id) : undefined
  }
  return false
}

export function findDoc(id: string): DocSummary | undefined {
  return DOCS.find((doc) => doc.id === id)
}

/** 휴지통으로. 이미 들어가 있으면 시각을 다시 찍지 않는다(백엔드와 같다). */
export function trashDoc(doc: DocSummary, user: User): void {
  if (doc.deleted_at) return
  doc.deleted_at = new Date().toISOString()
  doc.updated_by = { id: user.id, name: user.name }
}

export function untrashDoc(doc: DocSummary, user: User): DocSummary {
  doc.deleted_at = null
  doc.updated_at = new Date().toISOString()
  doc.updated_by = { id: user.id, name: user.name }
  return doc
}

/**
 * 영구 삭제. 버전·댓글까지 같이 지운다.
 *
 * 백엔드 `_purge` 는 여기에 더해 AI 색인을 지우고, 채팅에 붙은 문서 카드 참조를 풀고,
 * 공동편집 릴레이의 접속자를 끊는다. 목에는 그 셋이 없어 흉내 낼 대상이 아니다.
 */
export function purgeDoc(id: string): void {
  const index = DOCS.findIndex((doc) => doc.id === id)
  if (index >= 0) DOCS.splice(index, 1)
  delete versions[id]
  delete comments[id]
}

export function createDoc(user: User, folderId: string, title: string): DocSummary {
  const doc: DocSummary = {
    // 새로고침해도 겹치지 않아야 한다. 브라우저 IndexedDB 가 문서 id 로 본문을 남기므로
    // 카운터를 쓰면 두 번째로 만든 문서에 이전 본문이 뜬다.
    id: `d-${uuid()}`,
    folder_id: folderId,
    title,
    updated_at: new Date().toISOString(),
    updated_by: { id: user.id, name: user.name },
    deleted_at: null,
  }
  DOCS.unshift(doc)
  return doc
}

/** 제목의 원천은 Y.Doc이다. 여기 반영하는 건 목록·검색용 투영일 뿐이다. */
export function touchDoc(
  id: string,
  user: User,
  input: { title?: string; folder_id?: string },
): DocSummary | undefined {
  const doc = findDoc(id)
  if (!doc) return undefined
  // 빈 본문으로 "이어서 작업" 순서를 흔들지 않는다. 백엔드도 아무것도 안 바꾸고 그대로 준다.
  if (input.title === undefined && input.folder_id === undefined) return doc
  if (input.title !== undefined) doc.title = input.title
  if (input.folder_id !== undefined) doc.folder_id = input.folder_id
  doc.updated_at = new Date().toISOString()
  doc.updated_by = { id: user.id, name: user.name }
  return doc
}

// ── 버전 기록 ────────────────────────────────────────────────

const versions: Record<string, DocVersionSnapshot[]> = {}

/**
 * 같은 사람이 이어서 편집하는 동안 생기는 스냅샷을 하나로 접는 시간.
 * 접지 않으면 타이핑을 멈출 때마다 버전이 쌓여 기록을 읽을 수 없게 된다.
 */
const COALESCE_MS = 3 * 60_000

/** 최신순. **스냅샷은 싣지 않는다**(백엔드 `VersionMeta`). 내용은 `/restore` 로 한 건씩. */
export function listVersions(docId: string): DocVersion[] {
  return [...(versions[docId] ?? [])].reverse().map((version) => ({
    id: version.id,
    created_at: version.created_at,
    author: version.author,
    label: version.label,
  }))
}

export function findVersion(docId: string, versionId: string): DocVersionSnapshot | undefined {
  return versions[docId]?.find((version) => version.id === versionId)
}

export function addVersion(
  docId: string,
  user: User,
  snapshot: string,
  label?: string,
): DocVersionSnapshot {
  const history = (versions[docId] ??= [])
  const latest = history.at(-1)

  const version: DocVersionSnapshot = {
    id: `v-${nextId++}`,
    created_at: new Date().toISOString(),
    author: { id: user.id, name: user.name },
    snapshot,
    label: label ?? null,
  }

  // 같은 사람이 방금 남긴 무명 버전이면 새로 쌓지 않고 갱신한다.
  const coalescable =
    latest !== undefined &&
    !label &&
    !latest.label &&
    latest.author?.id === user.id &&
    Date.now() - new Date(latest.created_at).getTime() < COALESCE_MS

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

export function addComment(
  docId: string,
  user: User,
  body: string,
  blockId: string | null,
): DocComment {
  const comment: DocComment = {
    id: `cm-${nextId++}`,
    block_id: blockId,
    author: { id: user.id, name: user.name },
    body,
    created_at: new Date().toISOString(),
  }
  comments[docId] = [...(comments[docId] ?? []), comment]
  return comment
}

/**
 * 댓글을 지운다. 쓴 사람만 지울 수 있다(백엔드 #273, 임원도 남의 댓글은 못 지운다).
 * 화면은 버튼을 감출 뿐이고 여기가 판정한다.
 */
export function removeComment(
  docId: string,
  user: User,
  commentId: string,
): 'ok' | 'not_found' | 'forbidden' {
  const comment = comments[docId]?.find((c) => c.id === commentId)
  if (!comment) return 'not_found'
  if (comment.author.id !== user.id) return 'forbidden'
  comments[docId] = comments[docId].filter((c) => c !== comment)
  return 'ok'
}
