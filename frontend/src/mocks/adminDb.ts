import type { AdminUser, UserCreate, UserPatch } from '@/features/admin/types'
import { MOCK_USERS } from './db'

/**
 * 계정 관리용 저장소. 명단은 `db.ts` 의 `MOCK_USERS`(users.json) 를 그대로 쓰고, 여기에
 * 서버 `UserOut` 에만 있는 칸(활성 여부·입사일·생성 시각)을 얹는다.
 *
 * 명단을 새로 쓰면 채팅 릴레이·검색·게시판이 보는 사람과 관리 화면의 사람이 갈라진다.
 *
 * ponytail: 여기서 만든 계정으로 로그인은 안 된다. 로그인은 `MOCK_USERS` 를 보고,
 * 목은 비밀번호를 저장하지 않는다(데모 계정 하나를 다 같이 쓴다).
 */
const ACCOUNTS: AdminUser[] = MOCK_USERS.map((user, index) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  avatar: null,
  active: true,
  team_id: user.team?.id ?? null,
  // 입사일이 다 같으면 정렬·연차 화면에서 쓸모가 없다. 자리마다 한 해씩 벌린다.
  hire_date: `${2018 + (index % 6)}-0${1 + (index % 9)}-${String(1 + ((index * 3) % 27)).padStart(2, '0')}`,
  created_at: new Date(Date.UTC(2026, 0, 2 + index)).toISOString(),
}))

const byName = (a: AdminUser, b: AdminUser) => a.name.localeCompare(b.name, 'ko')

/** 서버는 이름순으로 준다(`order_by(User.name)`). */
export function listAccounts(): AdminUser[] {
  return [...ACCOUNTS].sort(byName)
}

export function findAccount(id: string): AdminUser | undefined {
  return ACCOUNTS.find((account) => account.id === id)
}

export function emailTaken(email: string): boolean {
  return ACCOUNTS.some((account) => account.email === email)
}

let nextId = 100

export function createAccount(body: UserCreate): AdminUser {
  const account: AdminUser = {
    id: `u-${nextId++}`,
    name: body.name.trim(),
    email: body.email.trim().toLowerCase(),
    role: body.role,
    avatar: null,
    active: true,
    team_id: null,
    hire_date: body.hire_date,
    created_at: new Date().toISOString(),
  }
  ACCOUNTS.push(account)
  return account
}

/** 보낸 칸만 바꾼다. 비밀번호는 목이 저장하지 않으므로 받기만 하고 버린다. */
export function patchAccount(account: AdminUser, patch: UserPatch): AdminUser {
  if (patch.name !== undefined) account.name = patch.name.trim()
  if (patch.role !== undefined) account.role = patch.role
  if (patch.active !== undefined) account.active = patch.active
  if (patch.hire_date !== undefined) account.hire_date = patch.hire_date
  return account
}
