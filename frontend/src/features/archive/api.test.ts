import { expect, it } from 'vitest'
import { downloadPath } from './api'

it('문서 파일과 채널 첨부 주소는 그대로 통과한다', () => {
  const doc = '/api/files/3f0c2a1e-9b7d-4c55-8a10-2f6e1d0b7c44'
  const chat = '/api/channels/c-dev/attachments/f-8/%EB%B3%B4%EA%B3%A0%EC%84%9C.pdf'
  expect(downloadPath(doc)).toBe(doc)
  expect(downloadPath(chat)).toBe(chat)
})

// 통과하면 「전체」라고 적힌 줄을 눌렀을 때 다른 채널의 경로를 요청한다.
it('다른 경로를 가리키게 만든 주소는 막는다', () => {
  const base = '/api/channels/c-dev/attachments'
  expect(downloadPath(`${base}/x/../../../c-hr/attachments/f-1/s.pdf`)).toBeNull()
  expect(downloadPath(`${base}/f-1/..`)).toBeNull()
  expect(downloadPath(`${base}/f-1/%2E%2e`)).toBeNull()
  expect(downloadPath(`${base}/f-1/..\\..\\me`)).toBeNull()
  expect(downloadPath(`${base}/f-1/a.pdf?next=x`)).toBeNull()
  expect(downloadPath('/api/me')).toBeNull()
  expect(downloadPath('/api/../index.html')).toBeNull()
  expect(downloadPath('https://evil.example/api/files/x')).toBeNull()
})
