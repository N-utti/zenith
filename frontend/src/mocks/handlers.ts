import { delay, http, HttpResponse, passthrough } from 'msw'
import type { User } from '@/types'
import { BODY_MAX, TITLE_MAX } from '@/features/board/types'
import { DEMO_PASSWORD } from './accounts'
import { clearMockSession, MOCK_USERS, setMockSession, userFromCookie } from './db'
import { AI_MODELS, answer, DOC_ACTIONS, docActionDraft } from './aiDb'
import {
  BOARD_DEFS,
  canEdit,
  canRead,
  createPost,
  deletePost,
  findPost,
  listBoards,
  listPosts,
  toDetail,
  updatePost,
} from './boardDb'
import { TODAY_TASKS } from './dashboardDb'
import {
  listMentions,
  listNotifications,
  markRead as markNotificationsRead,
} from './notificationsDb'
import { search } from './searchDb'
import {
  addComment,
  addVersion,
  createDoc,
  createFolder,
  docTree,
  findFolder,
  findVersion,
  isDescendantFolder,
  purgeDoc,
  trashDoc,
  untrashDoc,
  updateFolder,
  DOC_SEEDS,
  findDoc,
  listComments,
  listDocs,
  listVersions,
  touchDoc,
} from './docsDb'
import {
  attendanceMonth,
  companyAttendance,
  cancelException,
  createArrangement,
  createCorrection,
  createOvertime,
  listArrangements,
  listArrangementsInRange,
  listCorrections,
  listOvertime,
  MONTH,
  type ExceptionStore,
} from './attendanceDb'
import {
  APPROVAL_TYPES,
  cancelApproval,
  createDraft,
  decide,
  getApproval,
  listApprovals,
  submitApproval,
  updateDraft,
} from './approvalsDb'
import { readFile, saveFile } from './filesDb'
import { closeMonth, getClosing, listClosings, reopenMonth } from './closingsDb'
import { addHoliday, listHolidays, removeHoliday } from './holidaysDb'
import { createEvent, deleteEvent, listEvents } from './eventsDb'
import {
  cancelLeave,
  createLeave,
  LEAVE_TYPES,
  leaveBalance,
  listBalances,
  listLeaves,
  listLeavesInRange,
} from './leavesDb'

function authenticate(): User | undefined {
  // 세션은 쿠키다(04 §1). 핸들러는 페이지 안에서 돌므로 document.cookie 를 그대로 읽는다.
  return userFromCookie(document.cookie)
}

/** 사내망 파일 업로드 상한. 실제 서버(FastAPI)도 같은 값을 강제해야 한다. */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

const unauthorized = () =>
  HttpResponse.json({ detail: '로그인이 필요합니다.', code: 'AUTH_REQUIRED' }, { status: 401 })
const notFound = () =>
  HttpResponse.json({ detail: '문서를 찾을 수 없습니다.', code: 'NOT_FOUND' }, { status: 404 })

/**
 * 휴지통에 든 문서는 **읽기만** 된다. 백엔드는 수정·버전 저장·댓글 작성에서 404 다
 * (`_get_doc` 의 `trashed_ok`). 읽기(상세·버전 목록·댓글 목록)는 되돌리기 전에 확인할 수
 * 있어야 하므로 열어 둔다.
 */
function aliveDoc(id: string) {
  const doc = findDoc(id)
  return doc && !doc.deleted_at ? doc : undefined
}

/**
 * 권한 거부는 한 가지 문구뿐이다. 백엔드 `_deny` 도 열람 거부와 수정 거부를 구분해 주지
 * 않는다(`app/errors.py`). "이 게시판은 내 등급 밖" 과 "내 글이 아님" 을 호출자가 가려낼
 * 수 있으면 그 자체가 정보다.
 */
const forbidden = () =>
  HttpResponse.json({ detail: '권한이 부족합니다.', code: 'FORBIDDEN' }, { status: 403 })

const validationError = (detail: string) =>
  HttpResponse.json({ detail, code: 'VALIDATION' }, { status: 422 })

/** 본문이 JSON 이 아니면 500 대신 422 로 떨어뜨린다. 백엔드도 422 다. */
async function readJson<T>(request: Request): Promise<T | null> {
  try {
    const parsed: unknown = await request.json()
    return typeof parsed === 'object' && parsed !== null ? (parsed as T) : null
  } catch {
    return null
  }
}

/**
 * 글의 제목·본문 제약(`PostCreateIn`·`PostPatchIn`). 백엔드에서는 Pydantic 이 핸들러보다
 * 먼저 돌기 때문에 권한 검사보다 앞이다. `null` 은 여기서 보지 않는다(핸들러 안쪽 검사).
 */
function checkPostFields(body: { title?: unknown; body?: unknown }) {
  for (const [key, max, label] of [
    ['title', TITLE_MAX, '제목'],
    ['body', BODY_MAX, '내용'],
  ] as const) {
    const value = body[key]
    if (value === undefined || value === null) continue
    if (typeof value !== 'string') return validationError(`${label}은 문자열이어야 합니다.`)
    if (!value.trim()) return validationError('제목과 내용을 입력해 주세요.')
    if (value.trim().length > max) return validationError(`${label}은 ${max}자를 넘을 수 없습니다.`)
  }
  return null
}

/** 결재 목의 결과 → 응답. 실패는 `{error, status, code}` 모양(13 §9 의 403·404·409·422). */
function approvalResponse(
  result: { error: string; status: number; code: string } | object,
  ok = 200,
) {
  if ('error' in result) {
    return HttpResponse.json({ detail: result.error, code: result.code }, { status: result.status })
  }
  return HttpResponse.json(result, { status: ok })
}

/** 인증이 필요한 핸들러의 공통 껍데기. */
function authed(resolve: (user: User, request: Request) => Response) {
  return ({ request }: { request: Request }) => {
    const user = authenticate()
    return user ? resolve(user, request) : unauthorized()
  }
}

export const handlers = [
  // 채팅은 MSW가 흉내 내지 않는다. 브라우저마다 따로 도는 목으로는 메시지가
  // 공유되지 않기 때문이다. vite가 개발 서버(`npm run server`)로 넘기도록
  // 그대로 통과시킨다.
  //
  // 개발 릴레이(`scripts/chat.js`)가 실제로 여는 네 개만 넘긴다. `/api/channels/*` 로
  // 뭉뚱그리면 아직 안 만든 채널 생성·첨부까지 삼켜 릴레이의 404로 조용히 떨어지고,
  // 통과는 "처리됨"이라 onUnhandledRequest 경고도 안 뜬다.
  http.get('/api/channels', () => passthrough()),
  http.post('/api/channels', () => passthrough()),
  http.all('/api/channels/:channelId/messages', () => passthrough()),
  http.post('/api/channels/:channelId/read', () => passthrough()),

  // ── 인증 ──────────────────────────────────────────────────
  http.post('/api/auth/login', async ({ request }) => {
    const { email, password } = (await request.json()) as { email: string; password: string }
    const user = MOCK_USERS.find((u) => u.email === email.trim().toLowerCase())

    if (!user || password !== DEMO_PASSWORD) {
      return HttpResponse.json(
        { detail: '이메일 또는 비밀번호가 올바르지 않습니다.', code: 'AUTH_INVALID' },
        { status: 401 },
      )
    }

    // 04 §1: 204 + 쿠키. 본문에 토큰이 없다.
    setMockSession(user)
    return new HttpResponse(null, { status: 204 })
  }),

  http.post('/api/auth/refresh', () => {
    const user = authenticate()
    if (!user) return unauthorized()
    setMockSession(user)
    return new HttpResponse(null, { status: 204 })
  }),

  http.get(
    '/api/me',
    authed((user) => HttpResponse.json(user)),
  ),

  http.post('/api/auth/logout', () => {
    clearMockSession()
    return new HttpResponse(null, { status: 204 })
  }),

  // backend/README §1 확장. 성공 시 204, 현재 비밀번호 불일치는 400 PASSWORD_MISMATCH.
  // ponytail: 목은 비밀번호를 실제로 바꾸지 않는다. 데모 계정 전부가 DEMO_PASSWORD 하나를 쓴다.
  http.post('/api/me/password', async ({ request }) => {
    if (!authenticate()) return unauthorized()
    const { current_password, new_password } = (await request.json()) as {
      current_password: string
      new_password: string
    }
    if (current_password !== DEMO_PASSWORD) {
      return HttpResponse.json(
        { detail: '현재 비밀번호가 올바르지 않습니다.', code: 'PASSWORD_MISMATCH' },
        { status: 400 },
      )
    }
    if (new_password.length < 8) {
      return HttpResponse.json(
        { detail: [{ msg: 'String should have at least 8 characters' }], code: 'VALIDATION' },
        { status: 422 },
      )
    }
    return new HttpResponse(null, { status: 204 })
  }),

  // ── 게시판 ────────────────────────────────────────────────
  http.get(
    '/api/boards',
    authed((user) => HttpResponse.json({ items: listBoards(user) })),
  ),

  http.get(
    '/api/boards/:boardId/posts',
    authed((user, request) => {
      const boardId = new URL(request.url).pathname.split('/')[3]
      if (!BOARD_DEFS.some((board) => board.id === boardId)) return notFound()
      // 권한 밖 게시판이어도 목록 자체는 준다. 행이 전부 마스킹돼 나갈 뿐이다.
      return HttpResponse.json({ items: listPosts(user, boardId) })
    }),
  ),

  http.get('/api/posts/:postId', ({ params }) => {
    const user = authenticate()
    if (!user) return unauthorized()

    const post = findPost(String(params.postId))
    if (!post) return notFound()

    // 성공 기준: 목록은 마스킹, **본문은 403**. 제목조차 내려주지 않는다.
    if (!canRead(user, post.minRole)) {
      return HttpResponse.json(
        { detail: '열람 권한이 없습니다.', requiredRole: post.minRole, code: 'FORBIDDEN' },
        { status: 403 },
      )
    }

    return HttpResponse.json(toDetail(post))
  }),

  /**
   * 글쓴이 또는 임원만. 백엔드와 순서까지 맞춘다.
   *
   * 제목·본문의 모양 검증은 백엔드에서 Pydantic 이 하고, FastAPI 는 그걸 **핸들러에
   * 들어가기 전에** 돌린다. 그래서 권한 없는 사람이 너무 긴 제목을 보내면 403 이 아니라
   * 422 다. `null` 검사만은 백엔드도 핸들러 안(권한 검사 뒤)에 있어서 여기서도 뒤에 남긴다.
   */
  http.patch('/api/posts/:postId', async ({ request, params }) => {
    const user = authenticate()
    if (!user) return unauthorized()

    const body = await readJson<{ title?: unknown; body?: unknown }>(request)
    if (!body) return validationError('본문이 JSON 이 아닙니다.')
    const shapeError = checkPostFields(body)
    if (shapeError) return shapeError

    const post = findPost(String(params.postId))
    if (!post) return notFound()
    if (!canRead(user, post.minRole) || !canEdit(user, post)) return forbidden()

    // 보내지 않은 값은 그대로 둔다. null 은 "지움" 이 아니라 422 다.
    for (const key of ['title', 'body'] as const) {
      if (body[key] === null) return validationError(`${key} 는 null 일 수 없습니다.`)
    }

    return HttpResponse.json(
      updatePost(post, {
        title: typeof body.title === 'string' ? body.title.trim() : undefined,
        body: typeof body.body === 'string' ? body.body.trim() : undefined,
      }),
    )
  }),

  http.delete('/api/posts/:postId', ({ params }) => {
    const user = authenticate()
    if (!user) return unauthorized()

    const post = findPost(String(params.postId))
    if (!post) return notFound()
    if (!canRead(user, post.minRole) || !canEdit(user, post)) return forbidden()

    deletePost(post.id)
    return new HttpResponse(null, { status: 204 })
  }),

  http.post('/api/boards/:boardId/posts', async ({ request, params }) => {
    const user = authenticate()
    if (!user) return unauthorized()

    const boardId = String(params.boardId)
    const board = BOARD_DEFS.find((b) => b.id === boardId)
    if (!board) return notFound()

    // 05 FR-BRD-02. 열람할 수 있는 게시판에만 글을 쓸 수 있다.
    if (!canRead(user, board.minRole)) {
      return forbidden()
    }

    const parsed = await readJson<{ title?: unknown; body?: unknown }>(request)
    if (!parsed) return validationError('본문이 JSON 이 아닙니다.')
    if (typeof parsed.title !== 'string' || typeof parsed.body !== 'string') {
      return validationError('제목과 내용을 입력해 주세요.')
    }
    const shapeError = checkPostFields(parsed)
    if (shapeError) return shapeError

    return HttpResponse.json(
      createPost(user, boardId, { title: parsed.title.trim(), body: parsed.body.trim() }),
      { status: 201 },
    )
  }),

  // ── 홈 카드 ───────────────────────────────────────────────
  // 공지는 게시판의 일부다. 별도 데이터를 두면 두 벌이 되어 어긋난다.
  http.get(
    '/api/announcements',
    authed((user, request) => {
      const limit = Number(new URL(request.url).searchParams.get('limit') ?? 4)
      return HttpResponse.json({ items: listPosts(user).slice(0, limit) })
    }),
  ),

  // 멘션 카드는 알림에서 파생된다. 공지와 같은 이유로 별도 데이터를 두지 않는다.
  http.get(
    '/api/mentions',
    authed((user, request) => {
      const limit = Number(new URL(request.url).searchParams.get('limit') ?? 3)
      return HttpResponse.json({ items: listMentions(user, limit) })
    }),
  ),

  // ── 통합검색 (⌘K) ────────────────────────────────────────
  http.get(
    '/api/search',
    authed((user, request) => {
      const url = new URL(request.url)
      const q = url.searchParams.get('q') ?? ''
      // 백엔드는 1자 이상 200자 이하만 받는다(`Query(min_length=1, max_length=200)`).
      if (q.length < 1 || q.length > 200) {
        return validationError('검색어는 1자 이상 200자 이하여야 합니다.')
      }
      const raw = url.searchParams.get('limit')
      const limit = raw === null ? 20 : Number(raw)
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
        return validationError('limit 은 1 이상 50 이하의 정수여야 합니다.')
      }
      const types = (url.searchParams.get('types') ?? 'doc,chat,post')
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
      if (types.length === 0 || types.some((t) => !['doc', 'chat', 'post'].includes(t))) {
        return validationError('types 는 doc, chat, post 중에서.')
      }
      // 응답이 `{items}` 가 아니라 배열 그대로다.
      return HttpResponse.json(search(user, q, limit))
    }),
  ),

  // ── 알림함 (`/notifications`) ─────────────────────────────
  http.get(
    '/api/me/notifications',
    authed((user, request) => {
      const url = new URL(request.url)
      const unread = url.searchParams.get('unread') === '1'
      const raw = url.searchParams.get('limit')
      // 백엔드는 1 이상 200 이하만 받는다(`Query(50, ge=1, le=200)`). 숫자가 아니면 422.
      const limit = raw === null ? 50 : Number(raw)
      if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
        return validationError('limit 은 1 이상 200 이하의 정수여야 합니다.')
      }
      return HttpResponse.json({ items: listNotifications(user, { unread, limit }) })
    }),
  ),

  http.post('/api/me/notifications/read', async ({ request }) => {
    if (!authenticate()) return unauthorized()

    const body = await readJson<{ ids?: unknown }>(request)
    // 백엔드는 `ids` 를 1개 이상 200개 이하로 받는다(`ReadIn`).
    if (!body || !Array.isArray(body.ids) || body.ids.length === 0 || body.ids.length > 200) {
      return validationError('읽음 처리할 알림 id 를 1개 이상 200개 이하로 보내 주세요.')
    }
    markNotificationsRead(body.ids.map(String))
    return new HttpResponse(null, { status: 204 })
  }),

  http.get(
    '/api/tasks/today',
    authed(() => HttpResponse.json({ items: TODAY_TASKS })),
  ),

  // ── 전자결재 (13 §9) ──────────────────────────────────────
  http.get(
    '/api/approval-types',
    authed(() => HttpResponse.json({ items: APPROVAL_TYPES })),
  ),
  http.get(
    '/api/approvals',
    authed((user, request) => {
      const box = new URL(request.url).searchParams.get('box') ?? 'inbox'
      if (!['inbox', 'sent', 'reference', 'draft'].includes(box)) {
        return HttpResponse.json(
          { detail: 'box 가 올바르지 않습니다.', code: 'VALIDATION' },
          { status: 422 },
        )
      }
      return HttpResponse.json({ items: listApprovals(user, box as 'inbox'), next_cursor: null })
    }),
  ),
  http.post('/api/approvals/drafts', async ({ request }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    const result = createDraft(user, (await request.json()) as Parameters<typeof createDraft>[1])
    await delay(300)
    return approvalResponse(result, 201)
  }),
  http.patch('/api/approvals/drafts/:id', async ({ request, params }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    const input = (await request.json()) as Parameters<typeof updateDraft>[2]
    await delay(300)
    return approvalResponse(updateDraft(user, String(params.id), input))
  }),
  http.get(
    '/api/approvals/:id',
    authed((user, request) => {
      const id = new URL(request.url).pathname.split('/').pop() ?? ''
      return approvalResponse(getApproval(user, id))
    }),
  ),
  http.post('/api/approvals/:id/submit', async ({ params }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    await delay(400)
    return approvalResponse(submitApproval(user, String(params.id)))
  }),
  http.post('/api/approvals/:id/cancel', async ({ params }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    await delay(300)
    return approvalResponse(cancelApproval(user, String(params.id)))
  }),
  http.post('/api/approvals/:id/approve', async ({ request, params }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    const { version, comment } = (await request.json()) as { version: number; comment?: string }
    await delay(400)
    return approvalResponse(decide(user, String(params.id), 'approve', version, comment))
  }),
  http.post('/api/approvals/:id/reject', async ({ request, params }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    const { version, reason } = (await request.json()) as { version: number; reason?: string }
    await delay(400)
    return approvalResponse(decide(user, String(params.id), 'reject', version, reason))
  }),

  // ── 근태 · 내 근태 (04 §10.1) ─────────────────────────────
  http.get(
    '/api/attendance/me',
    authed((user, request) => {
      const month = new URL(request.url).searchParams.get('month') ?? ''
      if (!MONTH.test(month)) {
        return HttpResponse.json(
          { detail: 'month 는 YYYY-MM 형식입니다.', code: 'VALIDATION' },
          { status: 422 },
        )
      }
      return HttpResponse.json(attendanceMonth(user, month))
    }),
  ),

  // 04 §10.5 의 팀 그리드를 `team_id` 없이 부르면 전사. 팀장이 없는 조직이라 팀 단위는 안 쓴다. 임원 외 403(10 §3).
  http.get(
    '/api/attendance/team',
    authed((user, request) => {
      if (user.role !== 'exec') {
        return HttpResponse.json(
          { detail: '전사 근태는 임원만 볼 수 있습니다.', code: 'FORBIDDEN' },
          { status: 403 },
        )
      }
      const month = new URL(request.url).searchParams.get('month') ?? ''
      if (!MONTH.test(month)) {
        return HttpResponse.json(
          { detail: 'month 는 YYYY-MM 형식입니다.', code: 'VALIDATION' },
          { status: 422 },
        )
      }
      return HttpResponse.json(companyAttendance(month))
    }),
  ),

  // ── 근태 · 공휴일·회사 휴일 (10 §9.6, 임원) ─────────────
  // `?year=` 와 DELETE 는 프론트 확장(PR 본문). 바꾸면 근무 달력이 바로 따라온다(§6.2).
  http.get(
    '/api/admin/holidays',
    authed((user, request) => {
      if (user.role !== 'exec') {
        return HttpResponse.json(
          { detail: '휴일 설정은 임원만 볼 수 있습니다.', code: 'FORBIDDEN' },
          { status: 403 },
        )
      }
      const year = Number(new URL(request.url).searchParams.get('year'))
      if (!Number.isInteger(year) || year < 2000 || year > 2100) {
        return HttpResponse.json(
          { detail: 'year 는 네 자리 연도입니다.', code: 'VALIDATION' },
          { status: 422 },
        )
      }
      return HttpResponse.json({ items: listHolidays(year) })
    }),
  ),
  http.post('/api/admin/holidays', async ({ request }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    if (user.role !== 'exec') {
      return HttpResponse.json(
        { detail: '휴일 설정은 임원만 할 수 있습니다.', code: 'FORBIDDEN' },
        { status: 403 },
      )
    }
    const input = (await request.json()) as Parameters<typeof addHoliday>[0]
    await delay(300)
    const result = addHoliday(input)
    if ('error' in result) {
      return HttpResponse.json(
        { detail: result.error, code: result.code },
        { status: result.status },
      )
    }
    return HttpResponse.json(result.item, { status: 201 })
  }),
  http.delete('/api/admin/holidays/:date', async ({ params }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    if (user.role !== 'exec') {
      return HttpResponse.json(
        { detail: '휴일 설정은 임원만 할 수 있습니다.', code: 'FORBIDDEN' },
        { status: 403 },
      )
    }
    await delay(300)
    const result = removeHoliday(String(params.date))
    if (result === 'not_found') {
      return HttpResponse.json(
        { detail: '등록되지 않은 휴일입니다.', code: 'NOT_FOUND' },
        { status: 404 },
      )
    }
    if (result !== 'ok') {
      return HttpResponse.json(
        { detail: result.error, code: result.code },
        { status: result.status },
      )
    }
    return new HttpResponse(null, { status: 204 })
  }),

  // ── 근태 · 월 마감 (10 §9.5) ─────────────────────────────
  // 조회 경로는 프론트 확장(PR 본문). 마감 여부는 비밀이 아니라 전원 조회, 마감·해제만 임원(10 §3).
  http.get('/api/attendance/closings', ({ request }) => {
    if (!authenticate()) return unauthorized()
    const year = Number(new URL(request.url).searchParams.get('year'))
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      return HttpResponse.json(
        { detail: 'year 는 네 자리 연도입니다.', code: 'VALIDATION' },
        { status: 422 },
      )
    }
    return HttpResponse.json({ items: listClosings(year) })
  }),
  http.get('/api/attendance/closings/:month', ({ params }) => {
    if (!authenticate()) return unauthorized()
    const month = String(params.month)
    if (!MONTH.test(month)) {
      return HttpResponse.json(
        { detail: 'month 는 YYYY-MM 형식입니다.', code: 'VALIDATION' },
        { status: 422 },
      )
    }
    return HttpResponse.json(getClosing(month))
  }),
  http.post('/api/attendance/close', async ({ request }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    if (user.role !== 'exec') {
      return HttpResponse.json(
        { detail: '월 마감은 임원만 할 수 있습니다.', code: 'FORBIDDEN' },
        { status: 403 },
      )
    }
    const { month } = (await request.json()) as { month?: string }
    if (!month || !MONTH.test(month)) {
      return HttpResponse.json(
        { detail: 'month 는 YYYY-MM 형식입니다.', code: 'VALIDATION' },
        { status: 422 },
      )
    }
    await delay(400)
    const result = closeMonth(user, month)
    if ('error' in result) {
      return HttpResponse.json(
        { detail: result.error, code: result.code },
        { status: result.status },
      )
    }
    return HttpResponse.json(result.item)
  }),
  http.post('/api/attendance/reopen', async ({ request }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    if (user.role !== 'exec') {
      return HttpResponse.json(
        { detail: '마감 해제는 임원만 할 수 있습니다.', code: 'FORBIDDEN' },
        { status: 403 },
      )
    }
    const { month, reason } = (await request.json()) as { month?: string; reason?: string }
    if (!month || !MONTH.test(month)) {
      return HttpResponse.json(
        { detail: 'month 는 YYYY-MM 형식입니다.', code: 'VALIDATION' },
        { status: 422 },
      )
    }
    await delay(400)
    const result = reopenMonth(user, month, reason ?? '')
    if ('error' in result) {
      return HttpResponse.json(
        { detail: result.error, code: result.code },
        { status: result.status },
      )
    }
    return HttpResponse.json(result.item)
  }),

  // ── 근태 · 예외 근무 (04 §10.3) ───────────────────────────
  http.get(
    '/api/attendance/arrangements',
    authed((user, request) => {
      const params = new URL(request.url).searchParams
      // `scope=all` 은 04 에 없는 확장(홈 캘린더). 휴가의 `scope=all` 과 같은 모양.
      if (params.get('scope') === 'all') {
        return HttpResponse.json({
          items: listArrangementsInRange(params.get('from') ?? '', params.get('to') ?? ''),
        })
      }
      return HttpResponse.json({ items: listArrangements(user) })
    }),
  ),
  http.post('/api/attendance/arrangements', async ({ request }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    const input = (await request.json()) as Parameters<typeof createArrangement>[1]
    await delay(400)
    const result = createArrangement(user, input)
    if ('error' in result) {
      return HttpResponse.json(
        { detail: result.error, code: result.code },
        { status: result.status },
      )
    }
    return HttpResponse.json(result.item, { status: 201 })
  }),
  http.get(
    '/api/attendance/overtime',
    authed((user, request) => {
      const params = new URL(request.url).searchParams
      return HttpResponse.json(
        listOvertime(user, params.get('from') ?? '', params.get('to') ?? '9999'),
      )
    }),
  ),
  http.post('/api/attendance/overtime', async ({ request }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    const input = (await request.json()) as Parameters<typeof createOvertime>[1]
    await delay(400)
    const result = createOvertime(user, input)
    if ('error' in result) {
      return HttpResponse.json(
        { detail: result.error, code: result.code },
        { status: result.status },
      )
    }
    return HttpResponse.json(result.item, { status: 201 })
  }),
  http.get(
    '/api/attendance/corrections',
    authed((user) => HttpResponse.json({ items: listCorrections(user) })),
  ),
  http.post('/api/attendance/corrections', async ({ request }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    const input = (await request.json()) as Parameters<typeof createCorrection>[1]
    await delay(400)
    const result = createCorrection(user, input)
    if ('error' in result) {
      return HttpResponse.json(
        { detail: result.error, code: result.code },
        { status: result.status },
      )
    }
    return HttpResponse.json(result.item, { status: 201 })
  }),
  // 승인 전 취소. 04 에 없는 경로(프론트 확장, PR 본문). 휴가 취소와 같은 규칙.
  http.post('/api/attendance/:store/:id/cancel', async ({ params }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    const store = String(params.store)
    if (!['arrangements', 'overtime', 'corrections'].includes(store)) return passthrough()
    await delay(300)
    const result = cancelException(user, store as ExceptionStore, String(params.id))
    if (result === 'not_found') {
      return HttpResponse.json(
        { detail: '신청을 찾을 수 없습니다.', code: 'NOT_FOUND' },
        { status: 404 },
      )
    }
    if (result === 'conflict') {
      return HttpResponse.json(
        { detail: '이미 처리된 신청은 취소할 수 없습니다.', code: 'REQUEST_DECIDED' },
        { status: 409 },
      )
    }
    return HttpResponse.json(result)
  }),

  // ── 근태 · 휴가 (04 §10.2) ────────────────────────────────
  // 백엔드는 501 스텁. 목록 응답의 `{items}` 감싸기와 항목 모양은 프론트 가정(PR 본문).
  http.get(
    '/api/leave-types',
    authed(() => HttpResponse.json({ items: LEAVE_TYPES })),
  ),
  http.get(
    '/api/leaves/balance',
    authed((user) => HttpResponse.json(leaveBalance(user))),
  ),
  // 04 에 없는 확장(연차 관리 탭). 전사 잔여는 임원만(10 §3), 그 외 403.
  http.get(
    '/api/leaves/balances',
    authed((user) => {
      if (user.role !== 'exec') {
        return HttpResponse.json(
          { detail: '전사 연차 현황은 임원만 볼 수 있습니다.', code: 'FORBIDDEN' },
          { status: 403 },
        )
      }
      return HttpResponse.json({ items: listBalances() })
    }),
  ),
  http.get(
    '/api/leaves',
    authed((user, request) => {
      const params = new URL(request.url).searchParams
      // `scope=all` 은 04 에 없는 확장(홈 캘린더). 백엔드가 붙을 때 계약을 맞춘다.
      if (params.get('scope') === 'all') {
        const from = params.get('from') ?? ''
        const to = params.get('to') ?? ''
        return HttpResponse.json({ items: listLeavesInRange(from, to) })
      }
      return HttpResponse.json({ items: listLeaves(user) })
    }),
  ),

  http.post('/api/leaves', async ({ request }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    const input = (await request.json()) as Parameters<typeof createLeave>[1]
    await delay(400)
    const result = createLeave(user, input)
    if ('error' in result) {
      return HttpResponse.json(
        { detail: result.error, code: result.code },
        { status: result.status },
      )
    }
    return HttpResponse.json(result.leave, { status: 201 })
  }),

  http.post('/api/leaves/:leaveId/cancel', async ({ params }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    await delay(300)
    const result = cancelLeave(user, String(params.leaveId))
    if (result === 'not_found') {
      return HttpResponse.json(
        { detail: '휴가 신청을 찾을 수 없습니다.', code: 'NOT_FOUND' },
        { status: 404 },
      )
    }
    if (result === 'conflict') {
      return HttpResponse.json(
        { detail: '이미 처리된 신청은 취소할 수 없습니다.', code: 'LEAVE_DECIDED' },
        { status: 409 },
      )
    }
    return HttpResponse.json(result)
  }),

  // ── 내 일정 (04 에 없음. §2 /me/todos 와 같은 꼴로 가정) ──────
  http.get(
    '/api/me/events',
    authed((user, request) => {
      const params = new URL(request.url).searchParams
      return HttpResponse.json({
        items: listEvents(user, params.get('from') ?? '', params.get('to') ?? ''),
      })
    }),
  ),

  http.post('/api/me/events', async ({ request }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    const input = (await request.json()) as Parameters<typeof createEvent>[1]
    await delay(250)
    const result = createEvent(user, input)
    if ('error' in result) {
      return HttpResponse.json({ detail: result.error, code: 'VALIDATION' }, { status: 422 })
    }
    return HttpResponse.json(result.event, { status: 201 })
  }),

  http.delete('/api/me/events/:eventId', ({ params }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    if (!deleteEvent(user, String(params.eventId))) {
      return HttpResponse.json(
        { detail: '일정을 찾을 수 없습니다.', code: 'NOT_FOUND' },
        { status: 404 },
      )
    }
    return new HttpResponse(null, { status: 204 })
  }),

  // ── AI 어시스턴트 (04 §8) ─────────────────────────────────
  http.get(
    '/api/ai/models',
    authed(() => HttpResponse.json(AI_MODELS)),
  ),

  // SSE: token → citations → done. 실제 서버(routers/ai.py)와 같은 프레임 모양.
  http.post('/api/ai/chat', async ({ request }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    const { message } = (await request.json()) as { message?: string }
    if (!message?.trim()) {
      // 실제 서버(errors.py)의 422 detail 은 Pydantic 오류 배열이다. 문자열이 아니다.
      return HttpResponse.json(
        {
          detail: [
            {
              loc: ['body', 'message'],
              msg: 'String should have at least 1 character',
              type: 'string_too_short',
            },
          ],
          code: 'VALIDATION',
        },
        { status: 422 },
      )
    }
    const { body, citations } = answer(user)
    const frame = (event: string, data: unknown) => `event: ${event}
data: ${JSON.stringify(data)}

`
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        await delay(600)
        // 공급자 실패 경로(routers/ai.py LLMError). error 뒤에는 done 이 오지 않고 스트림이 끝난다.
        if (message.includes('오류')) {
          controller.enqueue(encoder.encode(frame('token', { text: '답변을 시작하다가 ' })))
          await delay(300)
          controller.enqueue(
            encoder.encode(
              frame('error', {
                detail: 'AI 요청이 몰려 있습니다. 잠시 후 다시 시도해 주세요.',
                code: 'AI_RATE_LIMITED',
              }),
            ),
          )
          controller.close()
          return
        }
        // 어절 단위로 흘려 보내 스트리밍 타이핑이 실제로 보이게 한다.
        for (const word of body.split(/(?<= )/)) {
          controller.enqueue(encoder.encode(frame('token', { text: word })))
          await delay(40)
        }
        controller.enqueue(encoder.encode(frame('citations', citations)))
        controller.enqueue(encoder.encode(frame('done', {})))
        controller.close()
      },
    })
    return new HttpResponse(stream, { headers: { 'Content-Type': 'text/event-stream' } })
  }),

  // 04 §8 feedback. 응답은 04 에 없다. 204 는 프론트 가정(PR 본문).
  http.post('/api/ai/feedback', async ({ request }) => {
    if (!authenticate()) return unauthorized()
    const { message_id, value } = (await request.json()) as {
      message_id?: unknown
      value?: unknown
    }
    const bad =
      typeof message_id !== 'string' || !message_id
        ? {
            loc: ['body', 'message_id'],
            msg: 'Input should be a valid string',
            type: 'string_type',
          }
        : value !== 1 && value !== -1
          ? { loc: ['body', 'value'], msg: 'Input should be 1 or -1', type: 'literal_error' }
          : null
    if (bad) return HttpResponse.json({ detail: [bad], code: 'VALIDATION' }, { status: 422 })
    await delay(300)
    return new HttpResponse(null, { status: 204 })
  }),

  // 04 §8 doc-action. 응답 모양은 04 에 없다. `{draft}` 는 프론트 제안(PR 본문).
  http.post('/api/ai/doc-action', async ({ request }) => {
    if (!authenticate()) return unauthorized()
    const { doc_id, action } = (await request.json()) as { doc_id?: string; action?: string }
    // 실제 서버는 Pydantic 검증(422)이 핸들러(404)보다 먼저다.
    if (!(DOC_ACTIONS as readonly string[]).includes(action ?? '')) {
      return HttpResponse.json(
        {
          detail: [
            {
              loc: ['body', 'action'],
              msg: 'Input should be one of the allowed actions',
              type: 'enum',
            },
          ],
          code: 'VALIDATION',
        },
        { status: 422 },
      )
    }
    const doc = doc_id ? findDoc(doc_id) : undefined
    if (!doc) return notFound()
    await delay(700)
    return HttpResponse.json({
      draft: docActionDraft(action as (typeof DOC_ACTIONS)[number], doc.title),
    })
  }),

  http.patch('/api/tasks/:taskId', async ({ request, params }) => {
    if (!authenticate()) return unauthorized()
    const task = TODAY_TASKS.find((item) => item.id === String(params.taskId))
    if (!task) return notFound()
    const body = (await request.json()) as { done?: boolean }
    if (body.done !== undefined) task.done = body.done
    return HttpResponse.json(task)
  }),

  http.get(
    '/api/docs/recent',
    authed((_user, request) => {
      const limit = Number(new URL(request.url).searchParams.get('limit') ?? 5)
      return HttpResponse.json({ items: listDocs('').slice(0, limit) })
    }),
  ),

  // ── 문서 트리·폴더 ────────────────────────────────────────
  http.get(
    '/api/tree',
    authed(() => HttpResponse.json(docTree())),
  ),

  http.post('/api/folders', async ({ request }) => {
    if (!authenticate()) return unauthorized()

    const body = await readJson<{ title?: unknown; parent_id?: unknown; sort?: unknown }>(request)
    if (!body) return validationError('본문이 JSON 이 아닙니다.')
    if (typeof body.title !== 'string' || !body.title.trim() || body.title.trim().length > 200) {
      return validationError('폴더 이름은 1자 이상 200자 이하여야 합니다.')
    }
    const parentId =
      body.parent_id === undefined || body.parent_id === null ? null : String(body.parent_id)
    // 없는 폴더는 404 가 아니라 422 다. 백엔드가 외래키 위반을 미리 잡아 422 로 돌려준다.
    if (parentId !== null && !findFolder(parentId)) return validationError('없는 폴더입니다.')

    return HttpResponse.json(
      createFolder({
        title: body.title.trim(),
        parent_id: parentId,
        sort: typeof body.sort === 'number' ? body.sort : 0,
      }),
      { status: 201 },
    )
  }),

  http.patch('/api/folders/:folderId', async ({ request, params }) => {
    if (!authenticate()) return unauthorized()

    const folder = findFolder(String(params.folderId))
    if (!folder) return notFound()

    const body = await readJson<{ title?: unknown; parent_id?: unknown; sort?: unknown }>(request)
    if (!body) return validationError('본문이 JSON 이 아닙니다.')
    // null 은 "지움" 이 아니라 422 다. 문서·할 일 PATCH 와 같은 계약.
    for (const key of ['title', 'parent_id', 'sort'] as const) {
      if (body[key] === null && key !== 'parent_id') {
        return validationError(`${key} 는 null 일 수 없습니다.`)
      }
    }
    if (body.title !== undefined) {
      if (typeof body.title !== 'string' || !body.title.trim() || body.title.trim().length > 200) {
        return validationError('폴더 이름은 1자 이상 200자 이하여야 합니다.')
      }
    }
    let parentId: string | null | undefined
    if (body.parent_id !== undefined) {
      parentId = body.parent_id === null ? null : String(body.parent_id)
      if (parentId !== null) {
        if (!findFolder(parentId)) return validationError('없는 폴더입니다.')
        // 자기 자신이나 자기 자손 아래로 옮기면 트리에서 통째로 사라진다.
        if (isDescendantFolder(parentId, folder.id)) {
          return validationError('폴더를 자기 자신이나 하위 폴더로 옮길 수 없습니다.')
        }
      }
    }

    return HttpResponse.json(
      updateFolder(folder, {
        title: typeof body.title === 'string' ? body.title.trim() : undefined,
        parent_id: parentId,
        sort: typeof body.sort === 'number' ? body.sort : undefined,
      }),
    )
  }),

  // ── 문서 ──────────────────────────────────────────────────
  http.get(
    '/api/docs',
    authed((_user, request) => {
      const query = new URL(request.url).searchParams.get('q') ?? ''
      return HttpResponse.json({ items: listDocs(query) })
    }),
  ),

  http.post('/api/docs', async ({ request }) => {
    const user = authenticate()
    if (!user) return unauthorized()

    const body = await readJson<{ folder_id?: unknown; title?: unknown }>(request)
    if (!body) return validationError('본문이 JSON 이 아닙니다.')
    // 백엔드 `DocCreateIn` 은 `folder_id` 와 `title` 을 둘 다 요구한다.
    if (typeof body.folder_id !== 'string' || !findFolder(body.folder_id)) {
      return validationError('folder_id 가 필요합니다.')
    }
    // 백엔드는 제목도 요구한다. 목이 기본값을 채워 주면 서버에서만 422 가 나는 자리가 생긴다.
    if (typeof body.title !== 'string' || !body.title.trim()) {
      return validationError('제목이 필요합니다.')
    }
    const title = body.title.trim()
    if (title.length > 200) return validationError('제목은 200자를 넘을 수 없습니다.')

    return HttpResponse.json(createDoc(user, body.folder_id, title), { status: 201 })
  }),

  http.get('/api/docs/:docId', ({ params }) => {
    if (!authenticate()) return unauthorized()
    const doc = findDoc(String(params.docId))
    if (!doc) return notFound()
    // 실제 서버는 보관 중인 Yjs 상태(`ydoc`)를 준다. 목에는 그게 없어 초안(`seedHtml`)으로 대신한다.
    return HttpResponse.json({ ...doc, ydoc: null, seedHtml: DOC_SEEDS[doc.id] })
  }),

  http.delete('/api/docs/:docId', ({ request, params }) => {
    const user = authenticate()
    if (!user) return unauthorized()

    const doc = findDoc(String(params.docId))
    if (!doc) return notFound()

    // 백엔드는 이 값을 불리언으로 읽는다. `1`·`true`·`yes`·`on` 이 참이고 그 밖은 422.
    const raw = new URL(request.url).searchParams.get('hard')
    if (raw !== null && !['1', '0', 'true', 'false', 'yes', 'no', 'on', 'off'].includes(raw)) {
      return validationError('hard 는 불리언이어야 합니다.')
    }
    // ?hard=1 은 영구 삭제. 임원만 할 수 있고 버전·댓글까지 같이 지운다.
    if (raw !== null && ['1', 'true', 'yes', 'on'].includes(raw)) {
      if (user.role !== 'exec') {
        return HttpResponse.json(
          { detail: '영구 삭제는 관리자만 할 수 있습니다.', code: 'FORBIDDEN' },
          { status: 403 },
        )
      }
      purgeDoc(doc.id)
      return new HttpResponse(null, { status: 204 })
    }

    trashDoc(doc, user)
    return new HttpResponse(null, { status: 204 })
  }),

  http.post('/api/docs/:docId/untrash', ({ params }) => {
    const user = authenticate()
    if (!user) return unauthorized()

    const doc = findDoc(String(params.docId))
    if (!doc) return notFound()
    return HttpResponse.json(untrashDoc(doc, user))
  }),

  http.patch('/api/docs/:docId', async ({ request, params }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    const body = await readJson<{ title?: unknown; folder_id?: unknown }>(request)
    if (!body) return validationError('본문이 JSON 이 아닙니다.')
    for (const key of ['title', 'folder_id'] as const) {
      if (body[key] === null) return validationError(`${key} 는 null 일 수 없습니다.`)
    }
    if (!aliveDoc(String(params.docId))) return notFound()
    if (body.folder_id !== undefined && !findFolder(String(body.folder_id))) {
      return validationError('없는 폴더입니다.')
    }
    const doc = touchDoc(String(params.docId), user, {
      title: typeof body.title === 'string' ? body.title : undefined,
      folder_id: typeof body.folder_id === 'string' ? body.folder_id : undefined,
    })
    return doc ? HttpResponse.json(doc) : notFound()
  }),

  // 휴지통 문서의 버전 목록은 열어 둔다(되돌리기 전에 확인할 수 있어야 한다). 없는 문서는 404.
  http.get('/api/docs/:docId/versions', ({ params }) => {
    if (!authenticate()) return unauthorized()
    if (!findDoc(String(params.docId))) return notFound()
    return HttpResponse.json({ items: listVersions(String(params.docId)) })
  }),

  /** 버전 복구. 그 버전의 스냅샷만 돌려준다. 되돌리는 일은 클라이언트가 한다. */
  http.post('/api/docs/:docId/restore', async ({ request, params }) => {
    if (!authenticate()) return unauthorized()

    const body = await readJson<{ version_id?: unknown }>(request)
    if (!body || typeof body.version_id !== 'string') {
      return validationError('version_id 가 필요합니다.')
    }
    // 휴지통에 든 문서는 되돌릴 수 없다(백엔드 `_get_doc` 기본값).
    if (!aliveDoc(String(params.docId))) return notFound()

    const version = findVersion(String(params.docId), body.version_id)
    if (!version) {
      return HttpResponse.json(
        { detail: '이 문서에 없는 버전입니다.', code: 'NOT_FOUND' },
        { status: 404 },
      )
    }
    return HttpResponse.json(version)
  }),

  http.post('/api/docs/:docId/versions', async ({ request, params }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    // 본문 검증이 먼저다. 백엔드는 FastAPI 가 핸들러에 들어가기 전에 스키마를 본다.
    const parsed = await readJson<{ snapshot?: unknown; label?: unknown }>(request)
    if (!parsed) return validationError('본문이 JSON 이 아닙니다.')
    const { snapshot, label } = parsed
    // 백엔드 `VersionCreateIn`: 스냅샷은 base64 이고 8MB 이하, 라벨은 1~200자.
    if (typeof snapshot !== 'string' || !snapshot.trim() || snapshot.length > 8_000_000) {
      return validationError('스냅샷이 없습니다.')
    }
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(snapshot)) {
      return validationError('snapshot 은 base64 여야 합니다.')
    }
    if (label !== undefined && label !== null) {
      if (typeof label !== 'string' || !label.trim() || label.trim().length > 200) {
        return validationError('라벨은 1자 이상 200자 이하여야 합니다.')
      }
    }
    if (!aliveDoc(String(params.docId))) return notFound()
    return HttpResponse.json(
      addVersion(
        String(params.docId),
        user,
        snapshot,
        typeof label === 'string' ? label : undefined,
      ),
      { status: 201 },
    )
  }),

  // ── 첨부 파일 ─────────────────────────────────────────────
  http.post('/api/files', async ({ request }) => {
    if (!authenticate()) return unauthorized()

    const file = (await request.formData()).get('file')
    if (!(file instanceof File)) {
      return HttpResponse.json({ detail: '파일이 없습니다.' }, { status: 400 })
    }
    if (!file.type.startsWith('image/')) {
      return HttpResponse.json({ detail: '이미지 파일만 올릴 수 있습니다.' }, { status: 415 })
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return HttpResponse.json({ detail: '10MB 이하 파일만 올릴 수 있습니다.' }, { status: 413 })
    }

    const stored = await saveFile(file)
    return HttpResponse.json(
      { id: stored.id, url: `/api/files/${stored.id}`, name: stored.name, size: stored.size },
      { status: 201 },
    )
  }),

  // <img src> 요청에는 Authorization 헤더가 붙지 않는다. 실제 서버는 서명 URL이나
  // 세션 쿠키로 막을 자리고, 목은 인증을 보지 않는다.
  http.get('/api/files/:fileId', async ({ params }) => {
    const stored = await readFile(String(params.fileId))
    if (!stored) return HttpResponse.json({ detail: '파일을 찾을 수 없습니다.' }, { status: 404 })
    return new HttpResponse(stored.blob, {
      headers: { 'Content-Type': stored.type, 'Content-Length': String(stored.size) },
    })
  }),

  http.get('/api/docs/:docId/comments', ({ params }) => {
    if (!authenticate()) return unauthorized()
    return HttpResponse.json({ items: listComments(String(params.docId)) })
  }),

  http.post('/api/docs/:docId/comments', async ({ request, params }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    const { body } = (await request.json()) as { body: string }
    if (!body.trim()) {
      return validationError('내용을 입력하세요.')
    }
    if (!aliveDoc(String(params.docId))) return notFound()
    return HttpResponse.json(addComment(String(params.docId), user, body.trim()), { status: 201 })
  }),
]
