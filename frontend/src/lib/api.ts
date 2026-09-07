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

function detailOf(body: unknown): string | null {
  return typeof body === 'object' && body !== null && 'detail' in body
    ? String((body as { detail: unknown }).detail)
    : null
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * `csrf` 는 서버가 HttpOnly 없이 내려주는 유일한 쿠키다. 상태 변경 요청에 헤더로 되돌려 보내면
 * 서버가 쿠키와 대조한다(11 §4.3 이중 제출). 교차 사이트에서는 이 헤더를 붙일 수 없어 CSRF 가 막힌다.
 */
function csrfToken(): string | null {
  const match = document.cookie.match(/(?:^|;\s*)csrf=([^;]*)/)
  return match ? decodeURIComponent(match[1]) : null
}

async function send(path: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json')
  // FormData는 브라우저가 boundary까지 넣어 Content-Type을 붙인다. 여기서 덮으면 깨진다.
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  if (!SAFE_METHODS.has((init.method ?? 'GET').toUpperCase())) {
    const token = csrfToken()
    if (token) headers.set('X-CSRF-Token', token)
  }
  // 세션은 HttpOnly 쿠키에 있다. 데스크탑 셸처럼 오리진이 다를 때도 쿠키를 실어 보낸다.
  return fetch(httpUrl(`/api${path}`), { ...init, headers, credentials: 'include' })
}

async function read(res: Response): Promise<unknown> {
  if (res.status === 204) return undefined
  const text = await res.text()
  return text ? JSON.parse(text) : undefined
}

let refreshing: Promise<boolean> | null = null

/**
 * 탭마다 따로 refresh 하면 둘 다 같은 refresh 토큰을 쓰고, 서버는 두 번째를 재사용(탈취)으로 보고
 * 세션을 통째로 닫는다. 같은 오리진의 탭이 공유하는 잠금으로 줄을 세운다 — 잠금을 얻었을 때는
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
 * 보낸다(TC-AUTH-02). 그래도 401 이면 진짜 만료 — 호출한 쪽이 로그인 화면으로 보낸다.
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
