import { describe, expect, it } from 'vitest'
import { userPatch, type UserForm } from './patch'
import type { AdminUser } from './types'

const USER: AdminUser = {
  id: 'u-1',
  name: '진수연',
  email: 'suyeon@zenith.co.kr',
  role: 'member',
  avatar: null,
  active: true,
  team_id: 'team-dev',
  hire_date: '2021-03-02',
  created_at: '2026-01-02T00:00:00Z',
}

const form = (over: Partial<UserForm> = {}): UserForm => ({
  name: USER.name,
  password: '',
  role: USER.role,
  hireDate: USER.hire_date ?? '',
  active: USER.active,
  ...over,
})

describe('userPatch', () => {
  it('바뀐 것이 없으면 빈 객체다', () => {
    expect(userPatch(USER, form())).toEqual({})
  })

  it('이름만 고치면 등급·활성은 실리지 않는다', () => {
    // 같이 실으면 내 계정을 고칠 때 서버가 ADMIN_SELF 로 막는다.
    const patch = userPatch(USER, form({ name: '진수연 ' }))
    expect(patch).toEqual({})

    const renamed = userPatch(USER, form({ name: '진수현' }))
    expect(renamed).toEqual({ name: '진수현' })
  })

  it('입사일을 비우면 null 을 보낸다', () => {
    expect(userPatch(USER, form({ hireDate: '' }))).toEqual({ hire_date: null })
  })

  it('비밀번호는 채운 경우에만 실린다', () => {
    expect(userPatch(USER, form({ password: '' })).password).toBeUndefined()
    expect(userPatch(USER, form({ password: 'zenith-temp-1' }))).toEqual({
      password: 'zenith-temp-1',
    })
  })

  it('비활성화는 active 만 바꾼다', () => {
    expect(userPatch(USER, form({ active: false }))).toEqual({ active: false })
  })
})
