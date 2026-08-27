import { http, HttpResponse } from 'msw'
import { DEMO_PASSWORD } from './accounts'
import { MOCK_USERS, tokenFor, userFromToken } from './db'

function authenticate(request: Request) {
  const header = request.headers.get('Authorization')
  return userFromToken(header?.replace(/^Bearer\s+/i, '') ?? null)
}

const unauthorized = () =>
  HttpResponse.json({ detail: '인증이 필요합니다.' }, { status: 401 })

export const handlers = [
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

  http.get('/api/auth/me', ({ request }) => {
    const user = authenticate(request)
    return user ? HttpResponse.json(user) : unauthorized()
  }),

  http.post('/api/auth/logout', () => new HttpResponse(null, { status: 204 })),
]
