import { delay, http, HttpResponse, passthrough } from 'msw'
import type { User } from '@/types'
import { DEMO_PASSWORD } from './accounts'
import { clearMockSession, MOCK_USERS, setMockSession, userFromCookie } from './db'
import { AI_MODELS, answer, DOC_ACTIONS, docActionDraft } from './aiDb'
import {
  BOARD_DEFS,
  canRead,
  createPost,
  findPost,
  listBoards,
  listPosts,
  toDetail,
} from './boardDb'
import { MENTIONS, TODAY_TASKS } from './dashboardDb'
import {
  addComment,
  addVersion,
  createDoc,
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
import { attendanceReportCsv } from './attendanceReport'
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
  http.all('/api/chat/*', () => passthrough()),

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
        { detail: '열람 권한이 없습니다.', requiredRole: post.minRole },
        { status: 403 },
      )
    }

    return HttpResponse.json(toDetail(post))
  }),

  http.post('/api/boards/:boardId/posts', async ({ request, params }) => {
    const user = authenticate()
    if (!user) return unauthorized()

    const boardId = String(params.boardId)
    const board = BOARD_DEFS.find((b) => b.id === boardId)
    if (!board) return notFound()

    // 05 FR-BRD-02. 열람할 수 있는 게시판에만 글을 쓸 수 있다.
    if (!canRead(user, board.minRole)) {
      return HttpResponse.json({ detail: '이 게시판에 글을 쓸 수 없습니다.' }, { status: 403 })
    }

    const { title, body } = (await request.json()) as { title: string; body: string }
    if (!title?.trim() || !body?.trim()) {
      return HttpResponse.json({ detail: '제목과 내용을 입력해 주세요.' }, { status: 400 })
    }

    return HttpResponse.json(
      createPost(user, boardId, { title: title.trim(), body: body.trim() }),
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

  http.get(
    '/api/mentions',
    authed((_user, request) => {
      const limit = Number(new URL(request.url).searchParams.get('limit') ?? 3)
      const sorted = [...MENTIONS].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      return HttpResponse.json({ items: sorted.slice(0, limit) })
    }),
  ),

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

  // 월 리포트 CSV(10 §9.5). 임원만. 전사 그리드와 같은 데이터를 표로 편 것.
  http.get(
    '/api/attendance/report',
    authed((user, request) => {
      if (user.role !== 'exec') {
        return HttpResponse.json(
          { detail: '리포트는 임원만 내려받을 수 있습니다.', code: 'FORBIDDEN' },
          { status: 403 },
        )
      }
      const params = new URL(request.url).searchParams
      const month = params.get('month') ?? ''
      if (!MONTH.test(month) || params.get('format') !== 'csv') {
        return HttpResponse.json(
          { detail: 'month 는 YYYY-MM, format 은 csv 입니다.', code: 'VALIDATION' },
          { status: 422 },
        )
      }
      return new HttpResponse(attendanceReportCsv(companyAttendance(month)), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="attendance-${month}.csv"`,
        },
      })
    }),
  ),

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
    '/api/documents/recent',
    authed((_user, request) => {
      const limit = Number(new URL(request.url).searchParams.get('limit') ?? 5)
      return HttpResponse.json({ items: listDocs('').slice(0, limit) })
    }),
  ),

  // ── 문서 ──────────────────────────────────────────────────
  http.get(
    '/api/documents',
    authed((_user, request) => {
      const query = new URL(request.url).searchParams.get('q') ?? ''
      return HttpResponse.json({ items: listDocs(query) })
    }),
  ),

  http.post(
    '/api/documents',
    authed((user) => HttpResponse.json(createDoc(user), { status: 201 })),
  ),

  http.get('/api/documents/:docId', ({ params }) => {
    if (!authenticate()) return unauthorized()
    const doc = findDoc(String(params.docId))
    if (!doc) return notFound()
    // 실제 서버라면 보관 중인 Yjs 초기 상태를 줄 자리다.
    return HttpResponse.json({ ...doc, seedHtml: DOC_SEEDS[doc.id] })
  }),

  http.patch('/api/documents/:docId', async ({ request, params }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    const { title } = (await request.json()) as { title?: string }
    const doc = touchDoc(String(params.docId), user, title)
    return doc ? HttpResponse.json(doc) : notFound()
  }),

  http.get('/api/documents/:docId/versions', ({ params }) => {
    if (!authenticate()) return unauthorized()
    return HttpResponse.json({ items: listVersions(String(params.docId)) })
  }),

  http.post('/api/documents/:docId/versions', async ({ request, params }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    const { snapshot, label } = (await request.json()) as { snapshot: string; label?: string }
    if (!snapshot) {
      return HttpResponse.json({ detail: '스냅샷이 없습니다.' }, { status: 400 })
    }
    return HttpResponse.json(addVersion(String(params.docId), user, snapshot, label), {
      status: 201,
    })
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

  http.get('/api/documents/:docId/comments', ({ params }) => {
    if (!authenticate()) return unauthorized()
    return HttpResponse.json({ items: listComments(String(params.docId)) })
  }),

  http.post('/api/documents/:docId/comments', async ({ request, params }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    const { body } = (await request.json()) as { body: string }
    if (!body.trim()) {
      return HttpResponse.json({ detail: '내용을 입력하세요.' }, { status: 400 })
    }
    return HttpResponse.json(addComment(String(params.docId), user, body.trim()), { status: 201 })
  }),
]
