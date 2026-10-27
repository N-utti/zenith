import { expect, it } from 'vitest'
import { FileText } from 'lucide-react'
import {
  hitRows,
  isSafeTo,
  matchPeople,
  matchRooms,
  paletteRows,
  personRows,
  roomRows,
} from './rows'
import type { ChatChannel } from '@/features/chat/types'
import type { Colleague } from '@/features/people/colleagues'
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
  const rows = paletteRows([nav], [], [], [])
  expect(rows.map((r) => r.kind)).toEqual(['nav', 'ask'])
  // 커서가 화면 이동 다음 칸에서 Enter 를 누르면 AI 행이다. 안 보이는 문서가 아니다.
  expect(rows[1].kind).toBe('ask')
})

it('그려지는 결과와 커서가 세는 결과가 같다', () => {
  const rows = paletteRows([nav], [], [], [hit('d-1'), hit('d-2')])
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

  const rows = paletteRows([], [], [], [hit('d-1'), hit('x', '//evil.example.com')])
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

const person = (id: string, name: string) => ({ id, name }) as Colleague
const dm = (id: string, otherId: string) =>
  ({ id, name: '상대', is_dm: true, members: [{ id: 'me' }, { id: otherId }] }) as ChatChannel

it('사람과 채팅방은 화면 이동과 검색 결과 사이에, 사람이 먼저 놓인다', () => {
  const rows = paletteRows([nav], [person('u-1', '김개발')], [room('c-1', '개발팀')], [hit('d-1')])
  expect(rows.map((r) => r.kind)).toEqual(['nav', 'person', 'room', 'hit', 'ask'])
  expect(personRows(rows).map((p) => p.id)).toEqual(['u-1'])
  expect(roomRows(rows).map((r) => r.id)).toEqual(['c-1'])
})

it('사람은 방과 같은 규칙으로 이름이 걸린다(@ 떼기, 시작하는 이름 먼저)', () => {
  const people = [person('u-1', '김민지'), person('u-2', '민지호'), person('u-3', '박서준')]
  expect(matchPeople(people, '@민지').map((p) => p.id)).toEqual(['u-2', 'u-1'])
  expect(matchPeople(people, ' ')).toEqual([])
})

it('명단에 있는 사람과의 DM 은 방으로 또 나오지 않고, 명단에 없는 상대의 DM 만 남는다', () => {
  // 사람 줄과 DM 줄이 같은 사람을 두 번 보이면 커서 한 칸이 헛돈다.
  const rooms = [
    { ...dm('d-1', 'u-1'), name: '김민지' },
    { ...dm('d-2', 'u-9'), name: '민지 퇴사자' },
  ]
  expect(matchRooms(rooms, '민지', [person('u-1', '김민지')]).map((r) => r.id)).toEqual(['d-2'])
  // 명단을 못 받았으면 DM 도 방으로 찾을 수 있다.
  expect(matchRooms(rooms, '민지').map((r) => r.id)).toEqual(['d-2', 'd-1'])
})

it('사람 줄이 다섯 명에서 잘리면 잘린 사람과의 DM 은 방으로 찾는다', () => {
  const people = Array.from({ length: 6 }, (_, i) => person(`u-${i}`, `김${i}`))
  const shown = matchPeople(people, '김')
  expect(shown.map((p) => p.id)).not.toContain('u-5')
  const rooms = [
    { ...dm('d-0', 'u-0'), name: '김0' },
    { ...dm('d-5', 'u-5'), name: '김5' },
  ]
  expect(matchRooms(rooms, '김', shown).map((r) => r.id)).toEqual(['d-5'])
})
