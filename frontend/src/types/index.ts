import type { components } from './api.gen'

/**
 * 실서버 계약(`backend/openapi.json`)에서 만든 스키마. `npm run gen:api` 가 `api.gen.ts` 를 만든다.
 * 응답 타입을 여기서 끌어오면 계약이 바뀔 때 손수 맞춘 타입 대신 tsc 가 먼저 깨진다.
 */
export type Schema<K extends keyof components['schemas']> = components['schemas'][K]

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

/**
 * 서버가 비밀번호에 거는 최소 길이(backend/app/config.py `password_min_length`). 내 비밀번호
 * 변경과 관리자의 임시 비밀번호가 같은 규칙을 본다.
 */
export const PASSWORD_MIN = 8

export type Team = Schema<'TeamOut'>

/**
 * 서버 `GET /me` 응답 그대로 (04-API §1 + 조직 `team`).
 * 아바타 색·직함은 서버에 없다. 색은 `lib/avatar.ts` 가 id 로 만들고, 직함 자리는 등급 라벨이 대신한다.
 * 서버는 `role` 을 문자열로만 알려 줘서 등급 셋으로 좁혀 둔다.
 */
export type User = Omit<Schema<'MeOut'>, 'role'> & { role: Role }
