import { expect, it } from 'vitest'
import { FileText } from 'lucide-react'
import { hitRows, isSafeTo, matchRooms, paletteRows, roomRows } from './rows'
import type { ChatChannel } from '@/features/chat/types'
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
  const rows = paletteRows([nav], [], [])
  expect(rows.map((r) => r.kind)).toEqual(['nav', 'ask'])
  // 커서가 화면 이동 다음 칸에서 Enter 를 누르면 AI 행이다. 안 보이는 문서가 아니다.
  expect(rows[1].kind).toBe('ask')
})

it('그려지는 결과와 커서가 세는 결과가 같다', () => {
  const rows = paletteRows([nav], [], [hit('d-1'), hit('d-2')])
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

  const rows = paletteRows([], [], [hit('d-1'), hit('x', '//evil.example.com')])
  expect(hitRows(rows).map((h) => h.id)).toEqual(['d-1'])
})

const room = (id: string, name: string) => ({ id, name }) as ChatChannel

it('채팅방은 이름에 검색어가 들면 대소문자 없이 걸리고, 빈 검색어면 하나도 안 나온다', () => {
  const rooms = [room('c-1', '개발팀'), room('c-2', 'General'), room('d-1', '김민지')]
  expect(matchRooms(rooms, '개발').map((r) => r.id)).toEqual(['c-1'])
  expect(matchRooms(rooms, 'gen').map((r) => r.id)).toEqual(['c-2'])
  expect(matchRooms(rooms, ' 민지 ').map((r) => r.id)).toEqual(['d-1'])
  expect(matchRooms(rooms, '  ')).toEqual([])
})

it('채팅방은 받은 순서(최근 대화순)와 상관없이 이름순이고, 검색어로 시작하는 방이 먼저다', () => {
  const recentFirst = [room('c-3', '프론트 개발'), room('c-1', '개발팀'), room('c-2', '개발 공지')]
  const expected = ['c-2', 'c-1', 'c-3']
  expect(matchRooms(recentFirst, '개발').map((r) => r.id)).toEqual(expected)
  // 새 메시지로 목록이 다시 섞여도 같은 줄에 같은 방이 있다.
  expect(matchRooms([...recentFirst].reverse(), '개발').map((r) => r.id)).toEqual(expected)
})

it('사이드바 표기처럼 # 이나 @ 를 붙여 쳐도 걸린다', () => {
  const rooms = [room('c-1', '개발팀'), room('d-1', '김민지')]
  expect(matchRooms(rooms, '#개발').map((r) => r.id)).toEqual(['c-1'])
  expect(matchRooms(rooms, '@민지').map((r) => r.id)).toEqual(['d-1'])
  expect(matchRooms(rooms, '#')).toEqual([])
})

it('채팅방은 다섯 개까지만 나온다', () => {
  const many = Array.from({ length: 8 }, (_, i) => room(`c-${i}`, `프로젝트 ${i}`))
  expect(matchRooms(many, '프로젝트')).toHaveLength(5)
})

it('채팅방은 화면 이동과 검색 결과 사이에 놓인다', () => {
  const rows = paletteRows([nav], [room('c-1', '개발팀')], [hit('d-1')])
  expect(rows.map((r) => r.kind)).toEqual(['nav', 'room', 'hit', 'ask'])
  expect(roomRows(rows).map((r) => r.id)).toEqual(['c-1'])
})
