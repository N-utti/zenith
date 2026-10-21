import { httpUrl } from './serverOrigin'

export class ApiError extends Error {
  readonly status: number
  /** 서버 에러 본문의 `code` (04-API §0). 없으면 null. */
  readonly code: string | null
  readonly body: unknown

  constructor(status: number, message: string, body?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = codeOf(body)
    this.body = body
  }
}

function codeOf(body: unknown): string | null {
  return typeof body === 'object' && body !== null && 'code' in body
    ? String((body as { code: unknown }).code)
    : null
}

/** 422 의 `detail` 은 Pydantic 오류 배열이라 문자열이 아니다. 그때는 호출부의 폴백 문구가 뜨게 null. */
function detailOf(body: unknown): string | null {
  const detail =
    typeof body === 'object' && body !== null && 'detail' in body
      ? (body as { detail: unknown }).detail
      : null
  return typeof detail === 'string' ? detail : null
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * `csrf` 는 서버가 HttpOnly 없이 내려주는 유일한 쿠키다. 상태 변경 요청에 헤더로 되돌려 보내면
 * 서버가 쿠키와 대조한다(11 §4.3 이중 제출). 교차 사이트에서는 이 헤더를 붙일 수 없어 CSRF 가 막힌다.
 */
function csrfToken(): string | null {
  const match = document.cookie.match(/(?:^|;\s*)csrf=([^;]*)/)
  return match ? decodeURIComponent(match[1]) : issuedCsrf
}

/**
 * 데스크탑 셸(오리진 tauri.localhost)은 서버 도메인의 csrf 쿠키를 document.cookie 로 못 읽는다.
 * 서버가 로그인·refresh·/me 응답에 같은 값을 X-CSRF-Token 헤더로도 주므로 받아 둔다(브라우저는 쿠키가 먼저).
 */
let issuedCsrf: string | null = null

async function send(path: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers)
  if (!headers.has('Accept')) headers.set('Accept', 'application/json')
  // FormData는 브라우저가 boundary까지 넣어 Content-Type을 붙인다. 여기서 덮으면 깨진다.
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  if (!SAFE_METHODS.has((init.method ?? 'GET').toUpperCase())) {
    const token = csrfToken()
    if (token) headers.set('X-CSRF-Token', token)
  }
  // 세션은 HttpOnly 쿠키에 있다. 데스크탑 셸처럼 오리진이 다를 때도 쿠키를 실어 보낸다.
  const res = await fetch(httpUrl(`/api${path}`), { ...init, headers, credentials: 'include' })
  issuedCsrf = res.headers.get('X-CSRF-Token') ?? issuedCsrf
  return res
}

async function read(res: Response): Promise<unknown> {
  if (res.status === 204) return undefined
  const text = await res.text()
  if (!text) return undefined
  try {
    return JSON.parse(text)
  } catch (err) {
    // 앱을 거치지 않은 에러(프록시의 502/504 HTML)는 JSON 이 아니다. 호출부의 상태 코드 문구가 뜨게 버린다.
    if (!res.ok) return undefined
    throw err
  }
}

let refreshing: Promise<boolean> | null = null

/**
 * 탭마다 따로 refresh 하면 둘 다 같은 refresh 토큰을 쓰고, 서버는 두 번째를 재사용(탈취)으로 보고
 * 세션을 통째로 닫는다. 같은 오리진의 탭이 공유하는 잠금으로 줄을 세운다. 잠금을 얻었을 때는
 * 앞선 탭이 바꿔 둔 최신 쿠키가 이미 브라우저에 있다.
 */
async function withCrossTabLock<T>(task: () => Promise<T>): Promise<T> {
  if (!('locks' in navigator)) return task()
  return await navigator.locks.request('zenith.refresh', task)
}

/** access 가 만료됐을 때 refresh 를 한 번만 부른다. 동시에 실패한 요청들은 같은 약속을 기다린다. */
function refreshSession(): Promise<boolean> {
  refreshing ??= withCrossTabLock(() =>
    send('/auth/refresh', { method: 'POST' }).then((res) => res.status === 204),
  )
    .catch(() => false)
    .finally(() => {
      refreshing = null
    })
  return refreshing
}

/**
 * 모든 API 호출의 단일 통로.
 * 개발 중에는 MSW가, MSW를 끄면 vite 프록시(→ FastAPI)가 이 요청을 받는다.
 * 데스크탑 셸에서는 `httpUrl`이 사내 서버 주소를 앞에 붙인다.
 *
 * 04 §1: access 는 15분이다. 만료(AUTH_EXPIRED)면 refresh 로 조용히 연장하고 원 요청을 한 번 다시
 * 보낸다(TC-AUTH-02). 그래도 401 이면 진짜 만료. 호출한 쪽이 로그인 화면으로 보낸다.
 */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res = await send(path, init)
  let body = await read(res)

  if (res.status === 401 && codeOf(body) === 'AUTH_EXPIRED' && (await refreshSession())) {
    res = await send(path, init)
    body = await read(res)
  }

  if (!res.ok) {
    throw new ApiError(res.status, detailOf(body) ?? `요청에 실패했습니다 (${res.status})`, body)
  }
  return body as T
}

/**
 * 파일 응답(CRM xlsx 내보내기). 만료 갱신·에러 정규화는 `api` 와 같고 본문만 바이트로 받는다.
 * 에러 본문은 `read()` 로 읽는다(JSON 이 아니면 상태 코드 문구).
 */
export async function apiBytes(path: string, init: RequestInit = {}): Promise<Uint8Array> {
  const headers = new Headers(init.headers)
  headers.set('Accept', '*/*')
  const request = { ...init, headers }
  let res = await send(path, request)
  if (res.status === 401) {
    const body = await read(res)
    if (codeOf(body) === 'AUTH_EXPIRED' && (await refreshSession())) res = await send(path, request)
    else throw new ApiError(401, detailOf(body) ?? '요청에 실패했습니다 (401)', body)
  }

  if (!res.ok) {
    const body = await read(res)
    throw new ApiError(res.status, detailOf(body) ?? `요청에 실패했습니다 (${res.status})`, body)
  }
  return new Uint8Array(await res.arrayBuffer())
}

export interface SseEvent {
  event: string
  data: unknown
}

/**
 * SSE 응답을 이벤트 단위로 넘긴다(04 §8 `/ai/chat`). `EventSource` 는 POST 도 쿠키 헤더도 못 쓰므로
 * `api()` 와 같은 통로(쿠키·CSRF·만료 시 refresh 1회)로 fetch 하고 본문을 직접 자른다.
 * 스트림 도중의 실패는 서버가 `event: error` 로 보내므로 호출한 쪽이 이벤트로 받는다.
 */
export async function* apiEvents(path: string, init: RequestInit = {}): AsyncGenerator<SseEvent> {
  const headers = new Headers(init.headers)
  headers.set('Accept', 'text/event-stream')
  const request = { ...init, headers }
  let res = await send(path, request)
  if (res.status === 401) {
    const body = await read(res)
    if (codeOf(body) === 'AUTH_EXPIRED' && (await refreshSession())) res = await send(path, request)
    else throw new ApiError(401, detailOf(body) ?? '요청에 실패했습니다 (401)', body)
  }
  if (!res.ok) {
    const body = await read(res)
    throw new ApiError(res.status, detailOf(body) ?? `요청에 실패했습니다 (${res.status})`, body)
  }
  if (!res.body) throw new ApiError(res.status, '스트림 응답이 아닙니다.')

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) {
        // 마지막 프레임 뒤에 빈 줄이 없어도 버리지 않는다.
        if (buffer.trim()) yield* parseFrames([buffer])
        return
      }
      buffer += value
      // 프레임 경계는 빈 줄. 마지막 조각은 다음 chunk 와 이어질 수 있어 남겨 둔다.
      const frames = buffer.split(/\r?\n\r?\n/)
      buffer = frames.pop() ?? ''
      yield* parseFrames(frames)
    }
  } finally {
    // 소비자가 `done` 에서 빠져나가거나 화면을 떠나도 연결을 붙들고 있지 않는다.
    await reader.cancel().catch(() => {})
  }
}

function* parseFrames(frames: string[]): Generator<SseEvent> {
  for (const frame of frames) {
    let event = 'message'
    const data: string[] = []
    for (const line of frame.split(/\r?\n/)) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      // 명세는 콜론 뒤 공백 하나만 뗀다.
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
    }
    if (data.length) yield { event, data: JSON.parse(data.join('\n')) }
  }
}
