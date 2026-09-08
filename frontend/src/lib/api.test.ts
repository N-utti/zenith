/**
 * lib/api.ts. 쿠키 세션의 클라이언트 쪽 규약(11 §4.3 CSRF · 04 §1 만료 갱신 · TC-AUTH-02).
 * fetch 를 통째로 바꿔 끼우고 호출 순서·헤더·재시도만 본다.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from './api'

function reply(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
  })
}

const fetchMock = vi.fn<typeof fetch>()
const calledUrls = () => fetchMock.mock.calls.map(([url]) => String(url))
const initOf = (index: number) => fetchMock.mock.calls[index][1]
const headersOf = (index: number) => new Headers(initOf(index)?.headers)

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  document.cookie = 'csrf=session-hmac; Path=/'
})

afterEach(() => {
  vi.unstubAllGlobals()
  document.cookie = 'csrf=; Path=/; Max-Age=0'
})

describe('api()', () => {
  it('쿠키를 싣고, 상태 변경 요청에만 csrf 쿠키를 X-CSRF-Token 으로 되돌린다', async () => {
    fetchMock.mockImplementation(async () => reply(200, { ok: true }))  // 응답 본문은 한 번만 읽힌다
    await api('/me')
    await api('/auth/logout', { method: 'POST' })
    expect(initOf(0)?.credentials).toBe('include')
    expect(headersOf(0).get('X-CSRF-Token')).toBeNull()
    expect(headersOf(1).get('X-CSRF-Token')).toBe('session-hmac')
  })

  it('204 는 undefined 로 돌아오고 JSON 본문에는 Content-Type 이 붙는다', async () => {
    fetchMock.mockImplementation(async () => reply(204))
    await expect(api('/auth/login', { method: 'POST', body: '{}' })).resolves.toBeUndefined()
    expect(headersOf(0).get('Content-Type')).toBe('application/json')
  })

  it('AUTH_EXPIRED 401 이면 refresh 를 한 번 부르고 원 요청을 다시 보낸다 (TC-AUTH-02)', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(401, { detail: '만료', code: 'AUTH_EXPIRED' }))
      .mockResolvedValueOnce(reply(204))
      .mockResolvedValueOnce(reply(200, { id: 'u-1' }))
    await expect(api('/me')).resolves.toEqual({ id: 'u-1' })
    expect(calledUrls()).toEqual(['/api/me', '/api/auth/refresh', '/api/me'])
    expect(initOf(1)?.method).toBe('POST')
    expect(headersOf(1).get('X-CSRF-Token')).toBe('session-hmac')
  })

  it('refresh 가 실패하면 재시도 없이 원래 401 을 ApiError 로 던진다', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(401, { detail: '만료', code: 'AUTH_EXPIRED' }))
      .mockResolvedValueOnce(reply(401, { detail: '끝', code: 'AUTH_INVALID' }))
    const error = await api('/me').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 401, code: 'AUTH_EXPIRED', message: '만료' })
    expect(calledUrls()).toEqual(['/api/me', '/api/auth/refresh'])
  })

  it('만료가 아닌 401 은 refresh 를 시도하지 않는다', async () => {
    fetchMock.mockResolvedValueOnce(
      reply(401, { detail: '로그인이 필요합니다.', code: 'AUTH_REQUIRED' }),
    )
    await expect(api('/me')).rejects.toMatchObject({ status: 401, code: 'AUTH_REQUIRED' })
    expect(calledUrls()).toEqual(['/api/me'])
  })

  it('동시에 만료된 요청들은 refresh 를 한 번만 부른다', async () => {
    let meCalls = 0
    fetchMock.mockImplementation(async (input) => {
      if (String(input).endsWith('/auth/refresh')) return reply(204)
      meCalls += 1
      return meCalls <= 2
        ? reply(401, { detail: '만료', code: 'AUTH_EXPIRED' })
        : reply(200, { n: meCalls })
    })
    const results = await Promise.all([api('/me'), api('/me')])
    expect(results).toEqual([{ n: 3 }, { n: 4 }])
    expect(calledUrls().filter((url) => url.endsWith('/auth/refresh'))).toHaveLength(1)
  })

  it('에러 본문의 detail 을 메시지로, 없으면 상태 코드를 쓴다', async () => {
    fetchMock.mockResolvedValueOnce(reply(500))
    await expect(api('/x')).rejects.toMatchObject({
      status: 500,
      code: null,
      message: '요청에 실패했습니다 (500)',
    })
  })
})
