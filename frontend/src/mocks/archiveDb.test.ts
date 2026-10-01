import { expect, it } from 'vitest'
import { chatFiles, docFiles, newestFirst } from './archiveDb'
import type { StoredFile } from './filesDb'

const author = { id: 'u-2', name: '정성운' }
const attachment = (name: string) => ({
  url: `/api/channels/c-1/attachments/f1/${name}`,
  name,
  size: 10,
  content_type: 'application/pdf',
})

it('메시지의 첨부를 한 줄씩 꺼내고, 올린 사람과 시각은 메시지의 것이다', () => {
  const files = chatFiles({ id: 'c-1', name: '개발', is_dm: false }, [
    { author, attachments: null, created_at: '2026-10-01T01:00:00Z' },
    {
      author,
      attachments: [attachment('a.pdf'), attachment('b.pdf')],
      created_at: '2026-10-01T02:00:00Z',
    },
  ])
  expect(files.map((f) => f.name)).toEqual(['a.pdf', 'b.pdf'])
  expect(files[0]).toMatchObject({
    source: 'chat',
    source_id: 'c-1',
    source_title: '개발',
    uploaded_by: author,
    created_at: '2026-10-01T02:00:00Z',
    scope: 'all',
  })
})

// 이 표시가 틀리면 멤버만 보는 파일을 「전체」로 알고 주소를 남에게 건넨다.
it('비공개 채널과 DM 의 파일은 열람 범위가 멤버로 좁혀진다', () => {
  const message = [
    { author, attachments: [attachment('a.pdf')], created_at: '2026-10-01T02:00:00Z' },
  ]
  const scope = (channel: { is_dm: boolean; is_private?: boolean }) =>
    chatFiles({ id: 'c-1', name: '방', ...channel }, message)[0].scope
  expect(scope({ is_dm: false })).toBe('all')
  expect(scope({ is_dm: false, is_private: false })).toBe('all')
  expect(scope({ is_dm: false, is_private: true })).toBe('members')
  expect(scope({ is_dm: true })).toBe('members')
})

const stored = (extra: Partial<StoredFile>): StoredFile => ({
  id: 'f-1',
  name: '계약서.pdf',
  type: 'application/pdf',
  size: 10,
  blob: new Blob(),
  doc_id: 'd-1',
  uploaded_by: author,
  created_at: '2026-10-01T03:00:00Z',
  ...extra,
})
const titleOf = (id: string) => (id === 'd-1' ? '로드맵' : undefined)

it('문서 파일은 올린 문서를 출처로 달고 전원이 본다', () => {
  expect(docFiles([stored({})], titleOf)).toEqual([
    {
      url: '/api/files/f-1',
      name: '계약서.pdf',
      size: 10,
      source: 'doc',
      source_id: 'd-1',
      source_title: '로드맵',
      uploaded_by: author,
      created_at: '2026-10-01T03:00:00Z',
      scope: 'all',
    },
  ])
})

// 지운 문서의 파일이 이름·올린 사람과 함께 전원에게 나열되면 안 된다.
it('휴지통에 들었거나 사라진 문서의 파일은 싣지 않는다', () => {
  // `titleOf` 는 살아 있는 문서의 제목만 준다. 못 찾으면 휴지통이거나 영구 삭제다.
  expect(docFiles([stored({ doc_id: 'd-휴지통' })], titleOf)).toEqual([])
  expect(docFiles([stored({ doc_id: null })], titleOf)).toEqual([])
})

// 결재 첨부가 자료실에 실리면 결재 문서의 열람 판정을 건너뛰고 파일의 존재와 이름이 샌다.
it('결재 첨부와 올린 기록이 없는 예전 파일은 싣지 않는다', () => {
  expect(docFiles([stored({ id: 'a-1' })], titleOf)).toEqual([])
  // 「결재 첨부면 뺀다」가 아니라 「문서 파일만 싣는다」다. 모르는 앞머리도 빠져야 한다.
  expect(docFiles([stored({ id: 'x-1' })], titleOf)).toEqual([])
  expect(docFiles([stored({ id: '1' })], titleOf)).toEqual([])
  expect(docFiles([stored({ created_at: undefined })], titleOf)).toEqual([])
})

it('올린 지 최근 순으로 상한만큼만 준다', () => {
  const at = (created_at: string) => docFiles([stored({ created_at })], titleOf)[0]
  const files = [at('2026-10-01T01:00:00Z'), at('2026-10-01T03:00:00Z'), at('2026-10-01T02:00:00Z')]
  expect(newestFirst(files, 2).map((f) => f.created_at)).toEqual([
    '2026-10-01T03:00:00Z',
    '2026-10-01T02:00:00Z',
  ])
})
