import { getToken } from './token'

export class ApiError extends Error {
  readonly status: number
  readonly body: unknown

  constructor(status: number, message: string, body?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

/**
 * 모든 API 호출의 단일 통로.
 * 개발 중에는 MSW가, MSW를 끄면 vite 프록시(→ FastAPI :8000)가 이 요청을 받는다.
 */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken()
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json')
  // FormData는 브라우저가 boundary까지 넣어 Content-Type을 붙인다. 여기서 덮으면 깨진다.
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const res = await fetch(`/api${path}`, { ...init, headers })

  if (res.status === 204) return undefined as T

  const text = await res.text()
  const body: unknown = text ? JSON.parse(text) : undefined

  if (!res.ok) {
    const message =
      (typeof body === 'object' && body !== null && 'detail' in body
        ? String((body as { detail: unknown }).detail)
        : null) ?? `요청에 실패했습니다 (${res.status})`
    throw new ApiError(res.status, message, body)
  }

  return body as T
}
