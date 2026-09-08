import type { Role, Team, User } from '@/types'
import users from './users.json'

/** 실제 조직도 기준 팀. 임원은 팀이 없다(`team: null`). */
export const MOCK_TEAMS: Record<string, Team> = {
  dev: { id: 'team-dev', name: '개발팀' },
  infra: { id: 'team-infra', name: '인프라 유치팀' },
  fund: { id: 'team-fund', name: '펀드팀' },
  research: { id: 'team-research', name: '디지털 리서치팀' },
  accounting: { id: 'team-accounting', name: '회계팀' },
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
