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

export interface User {
  id: string
  name: string
  email: string
  role: Role
  title: string
  team: Team
  /** 서버가 아직 없으므로 이니셜 아바타 색만 목 데이터로 내려준다. */
  avatarHue: number
}

export interface LoginResponse {
  token: string
  user: User
}
