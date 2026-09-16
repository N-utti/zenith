/**
 * lib/api.ts. 쿠키 세션의 클라이언트 쪽 규약(11 §4.3 CSRF · 04 §1 만료 갱신 · TC-AUTH-02).
 * fetch 를 통째로 바꿔 끼우고 호출 순서·헤더·재시도만 본다.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, apiEvents, ApiError } from './api'

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
    fetchMock.mockImplementation(async () => reply(200, { ok: true })) // 응답 본문은 한 번만 읽힌다
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

  it('JSON 이 아닌 본문(CSV)은 문자열 그대로 돌려준다', async () => {
    fetchMock.mockImplementation(
      async () => new Response('a,b\r\n', { status: 200, headers: { 'Content-Type': 'text/csv' } }),
    )
    await expect(api<string>('/attendance/report?month=2026-09&format=csv')).resolves.toBe(
      'a,b\r\n',
    )
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

describe('apiEvents()', () => {
  // jsdom 에는 Blob.stream 이 없다. chunk 경계를 시험하려면 직접 흘린다.
  const sse = (...chunks: string[]) =>
    new Response(
      new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder()
          for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
          controller.close()
        },
      }),
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    )

  async function collect(path: string) {
    const out: { event: string; data: unknown }[] = []
    for await (const e of apiEvents(path, { method: 'POST', body: '{}' })) out.push(e)
    return out
  }

  it('프레임을 event·data 로 자르고, chunk 경계에 걸린 프레임도 이어 붙인다 (04 §8)', async () => {
    fetchMock.mockImplementation(async () =>
      sse(
        'event: token\ndata: {"text":"안녕"}\n\nevent: tok',
        'en\ndata: {"text":"하세요"}\n\n',
        'event: citations\ndata: []\n\nevent: done\ndata: {}\n\n',
      ),
    )
    await expect(collect('/ai/chat')).resolves.toEqual([
      { event: 'token', data: { text: '안녕' } },
      { event: 'token', data: { text: '하세요' } },
      { event: 'citations', data: [] },
      { event: 'done', data: {} },
    ])
    expect(headersOf(0).get('Accept')).toBe('text/event-stream')
    expect(headersOf(0).get('X-CSRF-Token')).toBe('session-hmac')
  })

  it('AUTH_EXPIRED 401 이면 refresh 후 한 번 다시 연다', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(401, { detail: '만료', code: 'AUTH_EXPIRED' }))
      .mockResolvedValueOnce(reply(204))
      .mockResolvedValueOnce(sse('event: done\ndata: {}\n\n'))
    await expect(collect('/ai/chat')).resolves.toEqual([{ event: 'done', data: {} }])
    expect(calledUrls()).toEqual(['/api/ai/chat', '/api/auth/refresh', '/api/ai/chat'])
  })

  it('스트림이 아닌 에러 응답은 ApiError 로 던진다', async () => {
    fetchMock.mockResolvedValueOnce(
      reply(422, { detail: '질문을 입력해 주세요.', code: 'VALIDATION' }),
    )
    await expect(collect('/ai/chat')).rejects.toMatchObject({ status: 422, code: 'VALIDATION' })
  })
})

describe('apiEvents() 마무리', () => {
  it('마지막 프레임 뒤에 빈 줄이 없어도 버리지 않는다', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                'event: token' + String.fromCharCode(10) + 'data: {"text":"끝"}',
              ),
            )
            controller.close()
          },
        }),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      ),
    )
    const out: unknown[] = []
    for await (const e of apiEvents('/ai/chat', { method: 'POST', body: '{}' })) out.push(e)
    expect(out).toEqual([{ event: 'token', data: { text: '끝' } }])
  })

  it('detail 이 배열(422)이면 메시지는 폴백 문구가 된다', async () => {
    fetchMock.mockResolvedValueOnce(reply(422, { detail: [{ msg: 'x' }], code: 'VALIDATION' }))
    await expect(api('/ai/chat', { method: 'POST', body: '{}' })).rejects.toMatchObject({
      status: 422,
      message: '요청에 실패했습니다 (422)',
    })
  })
})
