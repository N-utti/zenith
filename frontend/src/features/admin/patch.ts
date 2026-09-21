import type { Role } from '@/types'
import type { AdminUser, UserPatch } from './types'

export interface UserForm {
  name: string
  password: string
  role: Role
  /** 팀 id. 비우면 빈 문자열이고, 소속 없음이라 `null` 로 바꿔 보낸다. */
  teamId: string
  /** `YYYY-MM-DD`. 비우면 빈 문자열이고, 그대로 보내면 안 되므로 `null` 로 바꾼다. */
  hireDate: string
  active: boolean
}

/**
 * 폼에서 **바뀐 칸만** 뽑는다. 빈 객체면 저장할 것이 없다는 뜻이다.
 *
 * 안 바뀐 값을 같이 보내면 안 된다. 서버는 자기 자신의 등급·활성 변경을 막는데, 그 판정이
 * 값 비교가 아니라 "그 칸이 본문에 있었는지" 로 갈린다(`exclude_unset`). 내 줄에서 이름만
 * 고쳐도 등급을 같이 실으면 400 이 된다.
 */
export function userPatch(user: AdminUser, form: UserForm): UserPatch {
  const patch: UserPatch = {}
  const name = form.name.trim()
  if (name !== user.name) patch.name = name
  if (form.role !== user.role) patch.role = form.role
  if (form.active !== user.active) patch.active = form.active
  if (form.teamId !== (user.team_id ?? '')) patch.team_id = form.teamId || null
  if (form.hireDate !== (user.hire_date ?? '')) patch.hire_date = form.hireDate || null
  if (form.password) patch.password = form.password
  return patch
}
