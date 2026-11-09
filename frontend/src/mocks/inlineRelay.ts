/**
 * 시연판 데스크톱 앱(apps/desktop 의 tauri.demo.conf.json)의 채팅·문서 릴레이.
 *
 * 브라우저 시연판과 개발 모드는 node 릴레이(scripts/chat.js·collab.js)를 따로 띄운다. 설치본에는 띄울 곳이
 * 없어서 같은 릴레이 코드를 화면 안에서 돌리고, REST 는 MSW 핸들러로·소켓은 MSW 의 WebSocket 흉내로
 * 잇는다. 릴레이가 기대하는 node 의 요청·응답·소켓 모양을 아래에서 흉내 낸다.
 *
 * 한 사람만 쓰는 앱이라 다른 사람의 답은 없다(`/ai` 봇 답은 온다). 앱을 종료하면 처음 상태로 돌아간다.
 *
 * MSW 는 WebSocket 핸들러가 하나라도 있으면 페이지의 소켓을 전부 가로챈다. 그래서 이 핸들러는
 * 릴레이가 없는 곳(시연 빌드의 데스크톱 앱)에서만 붙인다(browser.ts).
 */
import { http, ws, type WebSocketHandlerConnection } from 'msw'
import { wsUrl } from '@/lib/serverOrigin'
import { handleChatConnection, handleChatRequest, sessionUserId } from '../../scripts/chat.js'
import { handleCollabConnection } from '../../scripts/collab.js'

type Client = WebSocketHandlerConnection['client']

/** 릴레이가 쓰는 만큼의 node `ws` 소켓. */
function nodeSocket(client: Client) {
  let closed = false
  client.addEventListener('close', () => (closed = true))
  return {
    OPEN: 1,
    binaryType: 'arraybuffer',
    // 연결 이벤트는 소켓이 열리기 전에 온다. 그 사이 보낸 것은 MSW 가 열린 뒤에 전해 주므로 열린 것으로 친다.
    get readyState() {
      return closed ? 3 : 1
    },
    send: (data: string | Uint8Array) => client.send(data),
    close: (code?: number, reason?: string) => client.close(code, reason),
    on(type: 'message' | 'close', listener: (data?: unknown) => void) {
      if (type === 'message') client.addEventListener('message', (event) => listener(event.data))
      else client.addEventListener('close', () => listener())
    },
  }
}

/** 릴레이가 쓰는 만큼의 node 요청·응답으로 바꿔 넘기고, 끝낸 응답을 `Response` 로 돌려준다. */
async function chatRequest({ request }: { request: Request }): Promise<Response> {
  const url = new URL(request.url)
  url.pathname = url.pathname.replace(/^\/api/, '/chat')
  const type = request.headers.get('content-type') ?? ''

  // 첨부는 FormData 로 꺼내 둔다(chat.js 의 readMultipartFile). 나머지 본문은 글로 흘려준다(readBody).
  let file
  let text = ''
  if (type.startsWith('multipart/form-data')) {
    // 같은 이름 파트가 여럿이면 마지막 것(chat.js 의 node 파서·백엔드와 같다). 깨진 본문은 파일 없음(422)으로.
    const part = await request
      .formData()
      .then((form) => form.getAll('file').at(-1))
      .catch(() => null)
    file =
      part instanceof File
        ? {
            filename: part.name,
            contentType: part.type || 'application/octet-stream',
            data: new Uint8Array(await part.arrayBuffer()),
          }
        : null
  } else {
    text = await request.text()
  }
  const req = {
    method: request.method,
    headers: { cookie: document.cookie, 'content-type': type },
    file,
    on(event: string, listener: (chunk?: string) => void) {
      queueMicrotask(() => {
        if (event === 'data' && text) listener(text)
        if (event === 'end') listener()
      })
    },
  }

  return new Promise((resolve) => {
    let status = 200
    let headers: Record<string, string> = {}
    const res = {
      headersSent: false,
      writeHead(code: number, init: Record<string, string | number> = {}) {
        status = code
        headers = Object.fromEntries(Object.entries(init).map(([k, v]) => [k, String(v)]))
        res.headersSent = true
      },
      end(body?: string | Uint8Array) {
        const payload = status === 204 ? null : ((body ?? null) as BodyInit | null)
        resolve(new Response(payload, { status, headers }))
      },
    }
    handleChatRequest(req, res, url).catch((error: unknown) => {
      console.error('[inline-relay] 채팅 요청 실패', error)
      resolve(Response.json({ detail: '서버 오류' }, { status: 500 }))
    })
  })
}

export function inlineRelayHandlers() {
  const chat = ws.link(wsUrl('/api/ws'))
  const collab = ws.link(wsUrl('/api/yjs/*'))
  return [
    http.all('/api/channels', chatRequest),
    http.all('/api/channels/*', chatRequest),
    // 누구인지는 세션 쿠키가 말한다. node 릴레이의 업그레이드와 같다(demo.js).
    chat.addEventListener('connection', ({ client }) =>
      handleChatConnection(nodeSocket(client), sessionUserId({ headers: { cookie: document.cookie } }) ?? ''),
    ),
    collab.addEventListener('connection', ({ client }) => {
      const room = decodeURIComponent(client.url.pathname.slice('/api/yjs/'.length)) || 'default'
      handleCollabConnection(nodeSocket(client), room)
    }),
  ]
}
