import type { NavItem } from '@/app/navigation'
import type { ChatChannel } from '@/features/chat/types'
import type { Colleague } from '@/features/people/colleagues'
import type { SearchHit } from './types'

/**
 * ⌘K 목록의 한 줄. 화면 이동·사람·채팅방·검색 결과·AI 행이 한 배열에 이어 붙는다.
 *
 * 세 덩어리를 따로 세면 화면에 없는 줄까지 커서가 세는 일이 생긴다. 검색어를 지웠는데
 * 직전 결과가 캐시에 남아 있으면, 결과 구획은 사라졌는데 커서는 그 칸을 계속 세서 아무것도
 * 강조되지 않는 구간이 생기고 거기서 Enter 를 누르면 안 보이는 문서로 간다.
 * 그려지는 것과 세는 것을 같은 배열 하나로 묶는다.
 */
export type PaletteRow =
  | { kind: 'nav'; nav: NavItem }
  | { kind: 'person'; person: Colleague }
  | { kind: 'room'; room: ChatChannel }
  | { kind: 'hit'; hit: SearchHit }
  | { kind: 'ask' }

/** 서버가 준 갈 곳만 따라간다. 우리가 아는 화면인지는 한 번 확인한다. */
const SAFE_TO = /^\/(docs|chat|board)\/[^/]/

export function isSafeTo(to: string): boolean {
  return SAFE_TO.test(to)
}

/** 이름이 길게 맞아도 본문 검색 결과를 밀어내지 않게 자른다. */
const MAX_NAMES = 5

/**
 * 이름에 검색어가 든 것. 사이드바처럼 `#개발`·`@수진` 으로 쳐도 걸리게 앞의 `#`·`@` 는 떼고 비교한다.
 *
 * 순서는 이름으로 정한다(검색어로 시작하는 것 먼저). 받은 방 목록은 새 메시지가 올 때마다 최근
 * 대화순으로 다시 섞이는데(`withLastMessage`), 그 순서를 따르면 커서를 둔 줄에 다른 방이 올라와
 * Enter 가 엉뚱한 방으로 간다.
 */
function byName<T extends { name: string }>(items: T[], query: string): T[] {
  const q = query.trim().replace(/^[#@]/, '').toLowerCase()
  if (!q) return []
  const starts = (item: T) => (item.name.toLowerCase().startsWith(q) ? 0 : 1)
  return items
    .filter((item) => item.name.toLowerCase().includes(q))
    .sort((a, b) => starts(a) - starts(b) || a.name.localeCompare(b.name, 'ko'))
    .slice(0, MAX_NAMES)
}

/**
 * 이름이 맞는 동료(`GET /people`, 나와 비활성은 이미 뺀 명단). 고르면 그 사람과의 DM 으로 간다.
 * DM 을 아직 안 연 사람도 걸린다. 방 목록만 보던 때는 대화한 적 있는 사람만 찾을 수 있었다.
 */
export function matchPeople(people: Colleague[], query: string): Colleague[] {
  return byName(people, query)
}

/**
 * 이름에 검색어가 든 채널. 목록은 사이드바가 이미 받아 둔 내 방(`GET /channels`)이라 권한 밖 방은 애초에 없다.
 *
 * DM 은 사람 줄이 대신한다. 같은 사람이 사람 줄과 DM 줄로 두 번 걸리지 않게, 사람 줄에 보이는
 * 사람(`people`)과의 DM 은 뺀다. 그 밖의 상대(다섯 명에서 잘린 사람, 비활성 계정, 명단을 못 받았을 때)와의
 * DM 은 방으로 남는다.
 */
export function matchRooms(
  rooms: ChatChannel[],
  query: string,
  people: Colleague[] = [],
): ChatChannel[] {
  const listed = new Set(people.map((person) => person.id))
  return byName(
    rooms.filter((room) => !room.is_dm || !room.members.some((member) => listed.has(member.id))),
    query,
  )
}

export function paletteRows(
  navItems: NavItem[],
  people: Colleague[],
  rooms: ChatChannel[],
  hits: SearchHit[],
): PaletteRow[] {
  return [
    ...navItems.map((nav): PaletteRow => ({ kind: 'nav', nav })),
    ...people.map((person): PaletteRow => ({ kind: 'person', person })),
    ...rooms.map((room): PaletteRow => ({ kind: 'room', room })),
    ...hits.filter((hit) => isSafeTo(hit.to)).map((hit): PaletteRow => ({ kind: 'hit', hit })),
    { kind: 'ask' },
  ]
}

export function personRows(rows: PaletteRow[]): Colleague[] {
  return rows.flatMap((row) => (row.kind === 'person' ? [row.person] : []))
}

export function roomRows(rows: PaletteRow[]): ChatChannel[] {
  return rows.flatMap((row) => (row.kind === 'room' ? [row.room] : []))
}

/** 화면에 그려지는 검색 결과. 목록과 커서가 같은 것을 봐야 한다. */
export function hitRows(rows: PaletteRow[]): SearchHit[] {
  return rows.flatMap((row) => (row.kind === 'hit' ? [row.hit] : []))
}
