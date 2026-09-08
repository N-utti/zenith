/** 근태 모듈 설계서 §3의 역할 체계를 그대로 따른다. */
export type Role = 'member' | 'lead' | 'exec'

export const ROLE_LABEL: Record<Role, string> = {
  member: '사원',
  lead: '팀장',
  exec: '임원',
}

/** 낮을수록 권한이 좁다. 등급별 게시판·근태 조회 범위 판정에 쓴다. */
export const ROLE_RANK: Record<Role, number> = {
  member: 1,
  lead: 2,
  exec: 3,
}

export interface Team {
  id: string
  name: string
}

/**
 * 서버 `GET /me` 응답 그대로 (04-API §1 + 조직 `team`).
 * 아바타 색·직함은 서버에 없다. 색은 `lib/avatar.ts` 가 id 로 만들고, 직함 자리는 등급 라벨이 대신한다.
 */
export interface User {
  id: string
  name: string
  email: string
  role: Role
  avatar: string | null
  team: Team | null
}
