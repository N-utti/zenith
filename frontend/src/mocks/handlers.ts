import { http, HttpResponse } from 'msw'
import { ROLE_RANK, type User } from '@/types'
import { DEMO_PASSWORD } from './accounts'
import { MOCK_USERS, tokenFor, userFromToken } from './db'
import {
  ANNOUNCEMENTS,
  getAttendance,
  getTeamAlerts,
  punchIn,
  punchOut,
  undoCheckOut,
  UndoExpiredError,
  UNREAD_CHANNELS,
} from './dashboardDb'
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

function authenticate(request: Request): User | undefined {
  const header = request.headers.get('Authorization')
  return userFromToken(header?.replace(/^Bearer\s+/i, '') ?? null)
}

const unauthorized = () => HttpResponse.json({ detail: '인증이 필요합니다.' }, { status: 401 })
const forbidden = () => HttpResponse.json({ detail: '권한이 없습니다.' }, { status: 403 })
const notFound = () => HttpResponse.json({ detail: '문서를 찾을 수 없습니다.' }, { status: 404 })

/** 인증이 필요한 핸들러의 공통 껍데기. */
function authed(resolve: (user: User, request: Request) => Response) {
  return ({ request }: { request: Request }) => {
    const user = authenticate(request)
    return user ? resolve(user, request) : unauthorized()
  }
}

export const handlers = [
  // ── 인증 ──────────────────────────────────────────────────
  http.post('/api/auth/login', async ({ request }) => {
    const { email, password } = (await request.json()) as { email: string; password: string }
    const user = MOCK_USERS.find((u) => u.email === email.trim().toLowerCase())

    if (!user || password !== DEMO_PASSWORD) {
      return HttpResponse.json(
        { detail: '이메일 또는 비밀번호가 올바르지 않습니다.' },
        { status: 401 },
      )
    }

    return HttpResponse.json({ token: tokenFor(user), user })
  }),

  http.get('/api/auth/me', authed((user) => HttpResponse.json(user))),

  http.post('/api/auth/logout', () => new HttpResponse(null, { status: 204 })),

  // ── 근태 ──────────────────────────────────────────────────
  http.get('/api/attendance/summary', authed((user) => HttpResponse.json(getAttendance(user.id)))),

  http.post('/api/attendance/check-in', authed((user) => HttpResponse.json(punchIn(user.id)))),

  http.post('/api/attendance/check-out', authed((user) => HttpResponse.json(punchOut(user.id)))),

  http.post(
    '/api/attendance/check-out/undo',
    authed((user) => {
      try {
        return HttpResponse.json(undoCheckOut(user.id))
      } catch (error) {
        if (error instanceof UndoExpiredError) {
          return HttpResponse.json(
            { detail: '취소 가능 시간이 지났습니다. 근태 화면에서 보정을 신청하세요.' },
            { status: 409 },
          )
        }
        throw error
      }
    }),
  ),

  http.get(
    '/api/attendance/team-alerts',
    authed((user) => {
      // 설계서 NFR-ATT-02 — member는 타인 근태를 볼 수 없다.
      if (ROLE_RANK[user.role] < ROLE_RANK.lead) return forbidden()
      return HttpResponse.json({ alerts: getTeamAlerts(user) })
    }),
  ),

  // ── 홈 카드 ───────────────────────────────────────────────
  http.get(
    '/api/announcements',
    authed((user, request) => {
      const limit = Number(new URL(request.url).searchParams.get('limit') ?? 4)
      // 권한 밖 등급의 글은 목록에 아예 넣지 않는다.
      const visible = ANNOUNCEMENTS.filter(
        (item) => ROLE_RANK[user.role] >= ROLE_RANK[item.boardLevel],
      )
      const sorted = [...visible].sort(
        (a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt.localeCompare(a.createdAt),
      )
      return HttpResponse.json({ items: sorted.slice(0, limit) })
    }),
  ),

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

  http.post('/api/documents', authed((user) => HttpResponse.json(createDoc(user), { status: 201 }))),

  http.get('/api/documents/:docId', ({ request, params }) => {
    if (!authenticate(request)) return unauthorized()
    const doc = findDoc(String(params.docId))
    if (!doc) return notFound()
    // 실제 서버라면 보관 중인 Yjs 초기 상태를 줄 자리다.
    return HttpResponse.json({ ...doc, seedHtml: DOC_SEEDS[doc.id] })
  }),

  http.patch('/api/documents/:docId', async ({ request, params }) => {
    const user = authenticate(request)
    if (!user) return unauthorized()
    const { title } = (await request.json()) as { title?: string }
    const doc = touchDoc(String(params.docId), user, title)
    return doc ? HttpResponse.json(doc) : notFound()
  }),

  http.get('/api/documents/:docId/versions', ({ request, params }) => {
    if (!authenticate(request)) return unauthorized()
    return HttpResponse.json({ items: listVersions(String(params.docId)) })
  }),

  http.post('/api/documents/:docId/versions', async ({ request, params }) => {
    const user = authenticate(request)
    if (!user) return unauthorized()
    const { snapshot, label } = (await request.json()) as { snapshot: string; label?: string }
    if (!snapshot) {
      return HttpResponse.json({ detail: '스냅샷이 없습니다.' }, { status: 400 })
    }
    return HttpResponse.json(addVersion(String(params.docId), user, snapshot, label), {
      status: 201,
    })
  }),

  http.get('/api/documents/:docId/comments', ({ request, params }) => {
    if (!authenticate(request)) return unauthorized()
    return HttpResponse.json({ items: listComments(String(params.docId)) })
  }),

  http.post('/api/documents/:docId/comments', async ({ request, params }) => {
    const user = authenticate(request)
    if (!user) return unauthorized()
    const { body } = (await request.json()) as { body: string }
    if (!body.trim()) {
      return HttpResponse.json({ detail: '내용을 입력하세요.' }, { status: 400 })
    }
    return HttpResponse.json(addComment(String(params.docId), user, body.trim()), { status: 201 })
  }),

  http.get(
    '/api/chat/unread',
    authed(() =>
      HttpResponse.json({
        total: UNREAD_CHANNELS.reduce((sum, channel) => sum + channel.unread, 0),
        channels: UNREAD_CHANNELS,
      }),
    ),
  ),
]
