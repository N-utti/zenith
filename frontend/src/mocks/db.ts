import type { Role, Team, User } from '@/types'
import users from './users.json'

/**
 * 실제 조직도 기준 팀. 임원은 팀이 없다(`team: null`).
 *
 * id 는 서버와 같은 UUID 다(`TeamOut.id`, `format: uuid`). 읽기 좋은 `'team-dev'` 같은 문자열을
 * 쓰면 목에서는 통과하고 실제 서버에서 422 가 난다. 계정의 소속을 고르면 그 id 가 그대로
 * `PATCH /admin/users/{id}` 의 `team_id` 로 실려 나가기 때문이다.
 */
export const MOCK_TEAMS: Record<string, Team> = {
  dev: { id: '5f8d0c31-6a24-4b93-9e10-2c7a4f0b8d15', name: '개발팀' },
  infra: { id: 'a3e91b47-0d5c-4f28-8a63-1b9e5d2c7048', name: '인프라 유치팀' },
  fund: { id: 'c72b4e09-8f16-4d5a-b03e-6a1c9d84f237', name: '펀드팀' },
  research: { id: '1d4a7c62-3b90-4e81-95df-8c206b3a5e74', name: '디지털 리서치팀' },
  accounting: { id: '9b60f285-4c73-4a19-8d52-0e7f1a6c9384', name: '회계팀' },
}

/** `GET /admin/teams` 가 주는 모양. 서버는 이름순 배열로 준다(`{items}` 가 아니다). */
export const MOCK_TEAM_LIST: Team[] = Object.values(MOCK_TEAMS).sort((a, b) =>
  a.name.localeCompare(b.name, 'ko'),
)

const sortTeams = () => MOCK_TEAM_LIST.sort((a, b) => a.name.localeCompare(b.name, 'ko'))

export function createTeam(name: string): Team {
  const team = { id: crypto.randomUUID(), name }
  MOCK_TEAM_LIST.push(team)
  sortTeams()
  return team
}

/**
 * 객체를 제자리에서 고친다. `MOCK_USERS` 의 `team` 이 같은 객체를 가리키므로 `GET /me` 의 팀
 * 이름도 같이 바뀐다(서버에서 계정은 id 로 팀을 물고 있는 것과 같다).
 */
export function renameTeam(team: Team, name: string) {
  team.name = name
  sortTeams()
}

/**
 * 서버 `GET /me` 와 같은 모양(04 §1 + team). 명단은 users.json. 개발 채팅 서버(scripts/chat.js)도 같은 파일을 읽는다.
 * 조직도에 팀장 직급이 없어 lead 는 두지 않는다(사원·임원뿐). 아바타 색은 서버가 주지 않는다. lib/avatar 가 id 로 만든다.
 */
export const MOCK_USERS: User[] = users.map((u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role as Role,
  avatar: null,
  team: u.team ? MOCK_TEAMS[u.team] : null,
}))

/**
 * 목 세션 쿠키. 실제 서버의 HttpOnly `access` 대신 사용자 id 를 그대로 담는다. 개발 편의.
 * 개발 채팅 서버(scripts/dev-server.js)도 핸드셰이크의 이 쿠키로 사용자를 알아본다.
 *
 * MSW 2 의 핸들러는 페이지 안에서 돈다. 가로챈 요청의 Cookie 헤더는 JS 에 보이지 않고, 목 응답의
 * Set-Cookie 도 브라우저가 심어 주지 않으므로 document.cookie 를 직접 쓰고 직접 읽는다.
 */
export const SESSION_COOKIE = 'zenith.mock.session'

export function userFromCookie(header: string | null): User | undefined {
  const id = header
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1)
  return MOCK_USERS.find((user) => user.id === id)
}

/** 04 §1 의 Set-Cookie 를 흉내 낸다. `csrf` 는 lib/api.ts 가 읽어 헤더로 되돌리는 쿠키다(11 §4.3). */
export function setMockSession(user: User): void {
  document.cookie = `${SESSION_COOKIE}=${user.id}; Path=/; SameSite=Lax`
  document.cookie = `csrf=mock-csrf-${user.id}; Path=/; SameSite=Lax`
}

export function clearMockSession(): void {
  document.cookie = `${SESSION_COOKIE}=; Path=/; Max-Age=0`
  document.cookie = 'csrf=; Path=/; Max-Age=0'
}
