import { describe, expect, it } from 'vitest'
import { ALL_NAV, SECONDARY_NAV, visibleNav } from './navigation'

const labels = (role: 'member' | 'lead' | 'exec') => visibleNav(ALL_NAV, role).map((i) => i.label)

describe('visibleNav', () => {
  it('등급 제한이 없는 메뉴는 누구에게나 남는다', () => {
    expect(labels('member')).toContain('홈')
    expect(labels('member')).toContain('설정')
  })

  it('관리자는 임원에게만 보인다', () => {
    expect(labels('member')).not.toContain('관리자')
    expect(labels('lead')).not.toContain('관리자')
    expect(labels('exec')).toContain('관리자')
  })

  it('원본 배열을 건드리지 않는다', () => {
    const before = SECONDARY_NAV.length
    visibleNav(SECONDARY_NAV, 'member')
    expect(SECONDARY_NAV).toHaveLength(before)
  })
})
