import type {
  Board,
  BoardPost,
  BoardPostDetail,
  PostAttachment,
  PostComment,
} from '@/features/board/types'
import type { HomePost } from '@/features/home/types'
import { ROLE_RANK, type Role, type User } from '@/types'

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString()
}

/** 게시판 정의. `allowed`는 요청한 사용자의 등급으로 핸들러가 붙인다. */
export const BOARD_DEFS: Omit<Board, 'allowed'>[] = [
  { id: 'all', name: '전체 공지', min_role: 'member' },
  { id: 'lead', name: '팀장 회의록', min_role: 'lead' },
  { id: 'exec', name: '경영 보고', min_role: 'exec' },
]

/** 게시판 이름과 마스킹 여부는 내보낼 때 붙인다. */
export type StoredPost = Omit<BoardPostDetail, 'board_name' | 'masked'>

/**
 * 목에 없는 계정으로 올라간 글의 글쓴이. 실제 서버라면 전부 `users` 행을 가리키지만,
 * 목에는 경영지원팀 계정도 팀장 등급 계정도 없다. 어떤 데모 계정과도 id 가 맞지 않으므로
 * "내가 쓴 글" 분기에 걸리지 않고, 임원만 손댈 수 있다.
 */
const TEAM_HR = { id: 'team-hr', name: '경영지원팀' }
const LEAD_ONLY = { id: 'u-lead', name: '정성운' }

let nextId = 100

/**
 * 글 저장소. 홈의 `/announcements`도 여기서 파생된다.
 * 공지는 게시판의 일부이지 별도 데이터가 아니다.
 */
export const POSTS: StoredPost[] = [
  {
    id: 'p-1',
    board_id: 'all',
    min_role: 'member',
    title: '2026년 하반기 정기 워크숍 안내',
    author: TEAM_HR,
    created_at: minutesAgo(190),
    pinned: true,
    body: '하반기 정기 워크숍을 아래와 같이 진행합니다.\n\n· 일시: 2026년 9월 18일(금) 09:00 ~ 18:00\n· 장소: 본사 대회의실\n· 대상: 전 임직원\n\n참석 여부는 9월 5일까지 각 팀장에게 회신 부탁드립니다.',
  },
  {
    id: 'p-2',
    board_id: 'all',
    min_role: 'member',
    title: '제니스 사내 협업툴 파일럿 참여자 모집',
    author: { id: 'u-2', name: '정성운' },
    created_at: minutesAgo(1180),
    pinned: false,
    body: '사내 협업툴 제니스의 파일럿에 참여할 인원을 모집합니다.\n\n문서 공동편집·채팅·사내 AI를 먼저 써 보고 의견을 주실 분을 찾습니다. 기간은 2주이며, 기존 업무 방식과 병행합니다.\n\n관심 있으신 분은 #개발 채널로 알려 주세요.',
  },
  {
    id: 'p-3',
    board_id: 'all',
    min_role: 'member',
    title: '추석 연휴 근무 일정 · 대체휴무 안내',
    author: TEAM_HR,
    created_at: minutesAgo(3300),
    pinned: false,
    body: '추석 연휴 기간 근무 일정을 안내드립니다.\n\n연휴 중 당직이 필요한 팀은 팀장 승인 후 대체휴무를 신청할 수 있습니다. 신청은 근태 화면에서 처리해 주세요.',
  },
  {
    id: 'p-4',
    board_id: 'lead',
    min_role: 'lead',
    title: '3분기 인사평가 일정 및 평가자 배정',
    author: TEAM_HR,
    created_at: minutesAgo(2400),
    pinned: true,
    body: '3분기 인사평가를 아래 일정으로 진행합니다.\n\n· 자기평가: 9월 8일 ~ 12일\n· 1차 평가(팀장): 9월 15일 ~ 19일\n· 최종 조정: 9월 22일 ~ 24일\n\n평가자 배정표는 첨부를 확인해 주세요.',
  },
  {
    id: 'p-5',
    board_id: 'lead',
    min_role: 'lead',
    title: '8월 팀장 회의 결과 공유',
    author: LEAD_ONLY,
    created_at: minutesAgo(4600),
    pinned: false,
    body: '8월 팀장 회의 주요 결정사항입니다.\n\n1. 제니스 파일럿을 9월 첫 주 시작\n2. 근태 모듈은 정책 확정 후 착수\n3. 전자결재 도입 여부는 9월 중 재논의',
  },
  {
    id: 'p-6',
    board_id: 'exec',
    min_role: 'exec',
    title: '4분기 예산안 검토 회의 자료',
    author: { id: 'u-3', name: '홍성완' },
    created_at: minutesAgo(4100),
    pinned: false,
    body: '4분기 예산안 검토를 위한 자료입니다.\n\n부문별 집행 현황과 잔여 예산, 그리고 내년 초까지의 투자 계획을 정리했습니다.',
  },
]

export function canRead(user: User, minRole: Role): boolean {
  return ROLE_RANK[user.role] >= ROLE_RANK[minRole]
}

export function listBoards(user: User): Board[] {
  return BOARD_DEFS.map((board) => ({ ...board, allowed: canRead(user, board.min_role) }))
}

const boardName = (boardId: string) => BOARD_DEFS.find((b) => b.id === boardId)?.name ?? boardId

/** 목록에 나가는 모양. `body` 는 상세에만 싣는다. */
function toListShape(post: StoredPost): BoardPost {
  return {
    id: post.id,
    board_id: post.board_id,
    board_name: boardName(post.board_id),
    min_role: post.min_role,
    title: post.title,
    masked: false,
    author: post.author,
    created_at: post.created_at,
    pinned: post.pinned,
  }
}

/** 권한 밖 글은 제목·작성자를 가린 채로 내려간다. 목록에서 지우지 않는다. */
function toListItem(user: User, post: StoredPost): BoardPost {
  if (canRead(user, post.min_role)) return toListShape(post)
  return {
    ...toListShape(post),
    title: '＿'.repeat(6),
    // 백엔드도 마스킹된 행에는 글쓴이를 싣지 않는다(routers/boards.py `_post_out`).
    author: null,
    pinned: false,
    masked: true,
  }
}

/** `boardId`가 없으면 전체 게시판을 합쳐 최신순으로 준다 (홈 공지 카드가 쓴다). */
export function listPosts(user: User, boardId?: string): BoardPost[] {
  return POSTS.filter((post) => !boardId || post.board_id === boardId)
    .map((post) => toListItem(user, post))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.created_at.localeCompare(a.created_at))
}

/**
 * 홈 한 벌의 공지. 백엔드 `_posts` 와 같다. 최신순만 보고 고정(`pinned`)은 안 본다.
 * 권한 밖이면 제목을 가리고 `masked` 를 세운다. 게시판 이름·등급이 같이 실린다.
 */
export function homePosts(user: User, limit: number): HomePost[] {
  return [...POSTS]
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))
    .slice(0, limit)
    .map((post) => {
      const allowed = canRead(user, post.min_role)
      return {
        id: post.id,
        board_id: post.board_id,
        board_name: boardName(post.board_id),
        min_role: post.min_role,
        title: allowed ? post.title : '＿'.repeat(6),
        masked: !allowed,
        author: allowed ? post.author : null,
        created_at: post.created_at,
      }
    })
}

export function findPost(id: string): StoredPost | undefined {
  return POSTS.find((post) => post.id === id)
}

/** 글쓴이 본인 또는 임원. 백엔드 `routers/boards.py` 의 `_can_edit` 과 같은 판정이다. */
export function canEdit(user: User, post: StoredPost): boolean {
  return post.author?.id === user.id || user.role === 'exec'
}

export function updatePost(
  post: StoredPost,
  input: { title?: string; body?: string; attachments?: PostAttachment[] },
): BoardPostDetail {
  if (input.title !== undefined) post.title = input.title
  if (input.body !== undefined) post.body = input.body
  // 보낼 때는 늘 전체 목록이다. 빈 목록은 전부 뗀다는 뜻이고, 안 보내면 그대로 둔다.
  if (input.attachments !== undefined) post.attachments = input.attachments
  return toDetail(post)
}

export function deletePost(id: string): void {
  const index = POSTS.findIndex((post) => post.id === id)
  if (index >= 0) POSTS.splice(index, 1)
  // 글이 사라지면 댓글도 같이 사라진다.
  comments.delete(id)
}

export function createPost(
  user: User,
  boardId: string,
  input: { title: string; body: string; attachments?: PostAttachment[] },
): BoardPostDetail {
  const board = BOARD_DEFS.find((b) => b.id === boardId)
  if (!board) throw new Error('board not found')

  const post: StoredPost = {
    id: `p-${nextId++}`,
    board_id: boardId,
    min_role: board.min_role,
    title: input.title,
    author: { id: user.id, name: user.name },
    created_at: new Date().toISOString(),
    pinned: false,
    body: input.body,
    attachments: input.attachments ?? [],
  }
  POSTS.unshift(post)
  return toDetail(post)
}

/** 상세에 나가는 모양. 목록 한 줄에 본문을 더한다. */
export function toDetail(post: StoredPost): BoardPostDetail {
  return { ...toListShape(post), body: post.body, attachments: post.attachments ?? [] }
}

// ── 게시글 첨부 ──────────────────────────────────────────
// 서버에는 아직 없다. 채팅 첨부처럼 먼저 게시판 경로 밑에 올리고, 받은 값을 글에 실어 저장한다.
// 받기는 그 게시판의 살아 있는 글이 싣고 있는 파일만 내준다. 글에서 떼거나 글을 지우면 받을 수
// 없다(잘못 붙인 파일을 거둘 길이 그것뿐이다). 아직 글에 안 붙인 파일은 올린 사람만 받는다.
// ponytail: 뗀 파일의 오브젝트 자체는 저장소에 남는다. 정리는 서버가 정할 일이다(이슈 #299).

/** 글 하나에 붙일 수 있는 파일 수. 채팅·결재 첨부와 같다. */
const POST_ATTACHMENTS_MAX = 10

/** 이 게시판에 올린 첨부의 경로 앞부분. 첨부 url 은 늘 `앞부분 + 파일 id + / + 이름` 이다. */
export const postAttachmentPrefix = (boardId: string) => `/api/boards/${boardId}/attachments/`

/**
 * 파일 id → 올린 게시판과 올린 사람. 경로 모양만 보면 임원 게시판에 올린 파일 id 를 전체 공지 경로에
 * 끼워 넣어 등급 밖에서 받을 수 있다. 실서버는 저장 키에 게시판 id 를 넣어 같은 것을 막아야 한다.
 */
const uploads = new Map<string, { boardId: string; userId: string }>()

export function recordPostAttachment(boardId: string, fileId: string, userId: string) {
  uploads.set(fileId, { boardId, userId })
}

/**
 * 이 게시판에 올린 파일의 url 이면 `{파일 id, 이름}`, 아니면 `null`.
 *
 * 경로는 정확히 두 조각(파일 id, 이름)이어야 한다. 뒤에 `/../..` 를 더 붙인 url 이 통과하면 글의
 * 칩이 보이는 이름과 다른 주소를 가리키게 된다.
 */
function ownedFile(boardId: string, url: unknown): { id: string; name: string } | null {
  const prefix = postAttachmentPrefix(boardId)
  // 서버가 내준 주소에는 `?`·`#`·역슬래시가 없다(이름은 퍼센트 인코딩돼 있다).
  if (typeof url !== 'string' || !url.startsWith(prefix) || /[?#\\]/.test(url)) return null
  const [id, encoded, ...rest] = url.slice(prefix.length).split('/')
  if (!id || !encoded || rest.length > 0 || uploads.get(id)?.boardId !== boardId) return null
  try {
    const name = decodeURIComponent(encoded)
    return name === '.' || name === '..' ? null : { id, name }
  } catch {
    return null
  }
}

/** 글에 실려 온 첨부 목록의 검증. 문제가 없으면 `null`, 있으면 이유(422 의 문구). */
export function checkPostAttachments(boardId: string, files: unknown): string | null {
  // 안 보낸 것은 "그대로 둔다" 이다. `null` 은 지움이 아니라 잘못된 값이다.
  if (files === undefined) return null
  if (!Array.isArray(files)) return '첨부 목록이 올바르지 않습니다.'
  if (files.length > POST_ATTACHMENTS_MAX) return `첨부는 ${POST_ATTACHMENTS_MAX}개까지입니다.`
  const items = files as ({ url?: unknown; name?: unknown; size?: unknown } | null)[]
  // 이름은 url 의 이름과 같아야 한다. 다르면 칩에 보이는 이름과 받는 파일이 달라진다.
  const ok = items.every(
    (f) => typeof f?.size === 'number' && f.size >= 0 && ownedFile(boardId, f.url)?.name === f.name,
  )
  return ok ? null : '이 게시판에 올린 파일만 붙일 수 있습니다.'
}

/**
 * 이 주소의 파일을 받을 수 있는가. 게시판 등급은 부르는 쪽(핸들러)이 먼저 본다.
 * 살아 있는 글이 싣고 있으면 그 게시판을 읽는 누구나, 아니면 올린 사람만이다.
 */
export function canDownloadPostAttachment(user: User, boardId: string, url: string): boolean {
  const file = ownedFile(boardId, url)
  if (!file) return false
  if (uploads.get(file.id)?.userId === user.id) return true
  return POSTS.some(
    (post) =>
      post.board_id === boardId &&
      post.attachments?.some((f) => ownedFile(boardId, f.url)?.id === file.id),
  )
}

// ── 게시글 댓글 ──────────────────────────────────────────
// 글을 읽을 수 있는지(게시판 등급)는 핸들러가 먼저 본다. 여기는 댓글 한 줄의 권한만 본다.

/** 글 id → 댓글(오래된 순). */
const comments = new Map<string, PostComment[]>([
  [
    'p-1',
    [
      {
        id: 'pc-1',
        author: { id: 'u-1', name: '진수연' },
        body: '숙소 배정은 언제 공지되나요?',
        created_at: minutesAgo(150),
        edited_at: null,
      },
    ],
  ],
])
let nextCommentId = 2

export function listPostComments(postId: string): PostComment[] {
  return [...(comments.get(postId) ?? [])]
}

export function addPostComment(postId: string, user: User, body: string): PostComment {
  const comment: PostComment = {
    id: `pc-${nextCommentId++}`,
    author: { id: user.id, name: user.name },
    body,
    created_at: new Date().toISOString(),
    edited_at: null,
  }
  comments.set(postId, [...(comments.get(postId) ?? []), comment])
  return comment
}

/** 고치기는 쓴 사람만. 글이 그대로면 고친 것으로 치지 않는다(「수정됨」을 붙이지 않는다). */
export function editPostComment(
  postId: string,
  user: User,
  commentId: string,
  body: string,
): PostComment | 'not_found' | 'forbidden' {
  const comment = comments.get(postId)?.find((c) => c.id === commentId)
  if (!comment) return 'not_found'
  if (comment.author.id !== user.id) return 'forbidden'
  if (comment.body !== body) {
    comment.body = body
    comment.edited_at = new Date().toISOString()
  }
  return comment
}

/** 지우기는 쓴 사람 또는 임원. 글 지우기(`canEdit`)와 같은 기준이다(게시판은 임원이 정리한다). */
export function removePostComment(
  postId: string,
  user: User,
  commentId: string,
): 'ok' | 'not_found' | 'forbidden' {
  const list = comments.get(postId) ?? []
  const comment = list.find((c) => c.id === commentId)
  if (!comment) return 'not_found'
  if (comment.author.id !== user.id && user.role !== 'exec') return 'forbidden'
  comments.set(
    postId,
    list.filter((c) => c !== comment),
  )
  return 'ok'
}
