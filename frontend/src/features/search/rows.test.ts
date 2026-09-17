import { expect, it } from 'vitest'
import { FileText } from 'lucide-react'
import { hitRows, isSafeTo, paletteRows } from './rows'
import type { SearchHit } from './types'

const nav = { to: '/docs', label: '문서', icon: FileText }
const hit = (id: string, to = `/docs/${id}`): SearchHit => ({
  type: 'doc',
  id,
  title: id,
  sub: '',
  snippet: '',
  to,
  at: '2026-09-17T00:00:00Z',
})

it('검색 결과가 없으면 AI 행이 마지막이자 유일한 추가 행이다', () => {
  // 검색어를 지웠을 때 직전 결과가 캐시에 남아도 여기로 넘어오지 않아야 한다.
  const rows = paletteRows([nav], [])
  expect(rows.map((r) => r.kind)).toEqual(['nav', 'ask'])
  // 커서가 화면 이동 다음 칸에서 Enter 를 누르면 AI 행이다. 안 보이는 문서가 아니다.
  expect(rows[1].kind).toBe('ask')
})

it('그려지는 결과와 커서가 세는 결과가 같다', () => {
  const rows = paletteRows([nav], [hit('d-1'), hit('d-2')])
  expect(rows.map((r) => r.kind)).toEqual(['nav', 'hit', 'hit', 'ask'])
  expect(hitRows(rows).map((h) => h.id)).toEqual(['d-1', 'd-2'])
})

it('아는 화면이 아닌 갈 곳은 목록에 올리지 않는다', () => {
  expect(isSafeTo('/docs/d-1')).toBe(true)
  expect(isSafeTo('/chat/c-1?m=m-1')).toBe(true)
  expect(isSafeTo('/board/all/p-1')).toBe(true)
  expect(isSafeTo('/settings')).toBe(false)
  expect(isSafeTo('//evil.example.com')).toBe(false)
  expect(isSafeTo('javascript:alert(1)')).toBe(false)

  const rows = paletteRows([], [hit('d-1'), hit('x', '//evil.example.com')])
  expect(hitRows(rows).map((h) => h.id)).toEqual(['d-1'])
})
