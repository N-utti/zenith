import { delay, http, HttpResponse, passthrough } from 'msw'
import { ROLE_RANK, type User } from '@/types'
import { DEMO_PASSWORD } from './accounts'
import { MOCK_USERS, tokenFor, userFromToken } from './db'
import {
  AI_MODELS,
  AI_TEMPLATES,
  ask,
  KNOWLEDGE_SOURCES,
  listConversation,
  RECENT_QUESTIONS,
  resetConversation,
} from './aiDb'
import { ANNOUNCEMENTS, MENTIONS, TODAY_TASKS } from './dashboardDb'
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
import { readFile, saveFile } from './filesDb'

function authenticate(request: Request): User | undefined {
  const header = request.headers.get('Authorization')
  return userFromToken(header?.replace(/^Bearer\s+/i, '') ?? null)
}

/** 사내망 파일 업로드 상한. 실제 서버(FastAPI)도 같은 값을 강제해야 한다. */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

const unauthorized = () => HttpResponse.json({ detail: '인증이 필요합니다.' }, { status: 401 })
const notFound = () => HttpResponse.json({ detail: '문서를 찾을 수 없습니다.' }, { status: 404 })

/** 인증이 필요한 핸들러의 공통 껍데기. */
function authed(resolve: (user: User, request: Request) => Response) {
  return ({ request }: { request: Request }) => {
    const user = authenticate(request)
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
        { detail: '이메일 또는 비밀번호가 올바르지 않습니다.' },
        { status: 401 },
      )
    }

    return HttpResponse.json({ token: tokenFor(user), user })
  }),

  http.get('/api/auth/me', authed((user) => HttpResponse.json(user))),

  http.post('/api/auth/logout', () => new HttpResponse(null, { status: 204 })),

  // ── 홈 카드 ───────────────────────────────────────────────
  http.get(
    '/api/announcements',
    authed((user, request) => {
      const limit = Number(new URL(request.url).searchParams.get('limit') ?? 4)
      // 권한 밖 글은 목록에서 지우지 않고 제목만 가린다 (PRD 성공 기준: 제목 마스킹 + 본문 403).
      const items = ANNOUNCEMENTS.map((item) =>
        ROLE_RANK[user.role] >= ROLE_RANK[item.boardLevel]
          ? item
          : { ...item, title: '＿'.repeat(6), authorName: '＿＿＿', masked: true },
      )
      const sorted = [...items].sort(
        (a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt.localeCompare(a.createdAt),
      )
      return HttpResponse.json({ items: sorted.slice(0, limit) })
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

  http.get('/api/tasks/today', authed(() => HttpResponse.json({ items: TODAY_TASKS }))),

  // ── AI 어시스턴트 ─────────────────────────────────────────
  http.get(
    '/api/ai/meta',
    authed((user) =>
      HttpResponse.json({
        models: AI_MODELS,
        // 권한 밖 지식 소스는 목록에 남기되 고를 수 없다. 어떤 소스가 있는지는
        // 알아도 되지만, 그 안의 문장은 근거에서 아예 빠진다.
        sources: KNOWLEDGE_SOURCES.map((source) => ({
          ...source,
          allowed: !source.minRole || ROLE_RANK[user.role] >= ROLE_RANK[source.minRole],
        })),
        templates: AI_TEMPLATES,
        recent: RECENT_QUESTIONS,
      }),
    ),
  ),

  http.get('/api/ai/conversation', authed((user) => HttpResponse.json({ items: listConversation(user) }))),

  http.post('/api/ai/messages', async ({ request }) => {
    const user = authenticate(request)
    if (!user) return unauthorized()

    const { prompt } = (await request.json()) as { prompt: string }
    if (!prompt?.trim()) {
      return HttpResponse.json({ detail: '질문을 입력해 주세요.' }, { status: 400 })
    }

    // 로컬 LLM은 즉답하지 않는다. 생성 중 상태가 실제로 보이도록 지연을 준다.
    await delay(900)
    return HttpResponse.json({ items: ask(user, prompt.trim()) })
  }),

  http.delete('/api/ai/conversation', authed((user) => HttpResponse.json({ items: resetConversation(user) }))),

  http.patch('/api/tasks/:taskId', async ({ request, params }) => {
    if (!authenticate(request)) return unauthorized()
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

  // ── 첨부 파일 ─────────────────────────────────────────────
  http.post('/api/files', async ({ request }) => {
    if (!authenticate(request)) return unauthorized()

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
]
