import type { Role, Schema } from '@/types'

/**
 * `GET /admin/users` 의 한 줄 (04 §9 `UserOut`).
 *
 * `GET /me` 가 주는 `User` 와 다르다. 팀은 이름 없이 id 만 오고(`team_id`), 대신 계정 관리에
 * 필요한 활성 여부·입사일·생성 시각이 실린다. 아바타 색은 여기서도 서버가 주지 않는다.
 */
export type AdminUser = Omit<Schema<'UserOut'>, 'role'> & { role: Role }

/** `POST /admin/users` 본문. 셀프 가입이 없어서 계정은 이 경로로만 생긴다. */
export type UserCreate = Schema<'UserCreateIn'>

/** `null` 로 비울 수 있는 칸. 나머지는 스키마가 `null` 을 허용해도 서버 검사가 422 로 막는다. */
type Nullable = 'team_id' | 'hire_date'

/**
 * `PATCH /admin/users/{id}` 본문. **보낸 필드만** 바뀐다.
 *
 * 안 바뀐 값을 같이 보내면 안 된다. 서버는 자기 자신의 등급·활성 상태 변경을 `ADMIN_SELF` 로
 * 막는데, 그 판정이 값이 아니라 "필드가 왔는지" 로 갈린다. 내 줄에서 이름만 고쳐도 등급을
 * 같이 실으면 400 이 된다.
 *
 * `password` 를 보내면 임시 비밀번호로 재설정하고 그 사람의 세션을 전부 닫는다.
 */
export type UserPatch = Pick<Schema<'UserPatchIn'>, Nullable> & {
  [K in Exclude<keyof Schema<'UserPatchIn'>, Nullable>]?: NonNullable<Schema<'UserPatchIn'>[K]>
}

/** 서버가 `UserCreateIn.email` 에 거는 것과 같은 식. 10MB 짜리 정규식이 아니라 이 한 줄이 전부다. */
export const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
