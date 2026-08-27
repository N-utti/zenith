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
  RECENT_DOCS,
  UNREAD_CHANNELS,
} from './dashboardDb'

function authenticate(request: Request): User | undefined {
  const header = request.headers.get('Authorization')
  return userFromToken(header?.replace(/^Bearer\s+/i, '') ?? null)
}

const unauthorized = () => HttpResponse.json({ detail: '인증이 필요합니다.' }, { status: 401 })
const forbidden = () => HttpResponse.json({ detail: '권한이 없습니다.' }, { status: 403 })

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
      return HttpResponse.json({ items: RECENT_DOCS.slice(0, limit) })
    }),
  ),

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
