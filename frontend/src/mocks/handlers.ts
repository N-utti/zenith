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
import { readFile, saveFile } from './filesDb'

function authenticate(): User | undefined {
  // 세션은 쿠키다(04 §1). 핸들러는 페이지 안에서 돌므로 document.cookie 를 그대로 읽는다.
  return userFromCookie(document.cookie)
}

/** 사내망 파일 업로드 상한. 실제 서버(FastAPI)도 같은 값을 강제해야 한다. */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

const unauthorized = () =>
  HttpResponse.json({ detail: '로그인이 필요합니다.', code: 'AUTH_REQUIRED' }, { status: 401 })
const notFound = () => HttpResponse.json({ detail: '문서를 찾을 수 없습니다.', code: 'NOT_FOUND' }, { status: 404 })

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

  http.get('/api/me', authed((user) => HttpResponse.json(user))),

  http.post('/api/auth/logout', () => {
    clearMockSession()
    return new HttpResponse(null, { status: 204 })
  }),

  // ── 게시판 ────────────────────────────────────────────────
  http.get('/api/boards', authed((user) => HttpResponse.json({ items: listBoards(user) }))),

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

  http.get('/api/tasks/today', authed(() => HttpResponse.json({ items: TODAY_TASKS }))),

  // ── AI 어시스턴트 (04 §8) ─────────────────────────────────
  http.get('/api/ai/models', authed(() => HttpResponse.json(AI_MODELS))),

  // SSE: token → citations → done. 실제 서버(routers/ai.py)와 같은 프레임 모양.
  http.post('/api/ai/chat', async ({ request }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    const { message } = (await request.json()) as { message?: string }
    if (!message?.trim()) {
      // 실제 서버(errors.py)의 422 detail 은 Pydantic 오류 배열이다. 문자열이 아니다.
      return HttpResponse.json(
        {
          detail: [{ loc: ['body', 'message'], msg: 'String should have at least 1 character', type: 'string_too_short' }],
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
              frame('error', { detail: 'AI 요청이 몰려 있습니다. 잠시 후 다시 시도해 주세요.', code: 'AI_RATE_LIMITED' }),
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

  // 04 §8 doc-action. 응답 모양은 04 에 없다. `{draft}` 는 프론트 제안(PR 본문).
  http.post('/api/ai/doc-action', async ({ request }) => {
    if (!authenticate()) return unauthorized()
    const { doc_id, action } = (await request.json()) as { doc_id?: string; action?: string }
    // 실제 서버는 Pydantic 검증(422)이 핸들러(404)보다 먼저다.
    if (!(DOC_ACTIONS as readonly string[]).includes(action ?? '')) {
      return HttpResponse.json(
        { detail: [{ loc: ['body', 'action'], msg: 'Input should be one of the allowed actions', type: 'enum' }], code: 'VALIDATION' },
        { status: 422 },
      )
    }
    const doc = doc_id ? findDoc(doc_id) : undefined
    if (!doc) return notFound()
    await delay(700)
    return HttpResponse.json({ draft: docActionDraft(action as (typeof DOC_ACTIONS)[number], doc.title) })
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

  http.post('/api/documents', authed((user) => HttpResponse.json(createDoc(user), { status: 201 }))),

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
