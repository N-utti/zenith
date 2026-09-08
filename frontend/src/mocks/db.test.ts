import { describe, expect, it } from 'vitest'

import { DEMO_ACCOUNTS } from './accounts'
import { MOCK_USERS } from './db'

describe('목 사용자 픽스처', () => {
  it('id·이메일이 겹치지 않는다', () => {
    expect(new Set(MOCK_USERS.map((u) => u.id)).size).toBe(MOCK_USERS.length)
    expect(new Set(MOCK_USERS.map((u) => u.email)).size).toBe(MOCK_USERS.length)
  })

  it('로그인 바로가기 계정은 모두 명단에 있고 등급별로 하나씩이다', () => {
    const roles = DEMO_ACCOUNTS.map((a) => MOCK_USERS.find((u) => u.email === a.email)?.role)
    expect(roles).toEqual(['member', 'exec'])
  })
})
