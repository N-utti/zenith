import { describe, expect, it } from 'vitest'
import { auditView, type AuditEvent } from './audit'

const event = (over: Partial<AuditEvent>): AuditEvent => ({
  id: 'a-1',
  at: '2026-09-17T01:00:00Z',
  kind: 'auth.login_ok',
  actor_id: 'u-1',
  target_id: null,
  ip: '10.0.1.24',
  user_agent: 'Mozilla/5.0',
  detail: null,
  ...over,
})

describe('auditView', () => {
  it('모르는 종류는 종류 이름을 그대로 보여 준다', () => {
    // 줄이 사라지거나 빈칸이 되면 "무슨 일이 있었는지 다 남는다" 는 전제가 깨진다.
    const view = auditView(event({ kind: 'approvals.something_new' }))
    expect(view.summary).toBe('approvals.something_new')
  })

  it('로그인 실패는 이유를 가른다', () => {
    const wrong = auditView(event({ kind: 'auth.login_fail', detail: { email: 'a@b.co' } }))
    expect(wrong.detail).toBe('a@b.co · 비밀번호 불일치')

    const disabled = auditView(
      event({ kind: 'auth.login_fail', detail: { email: 'a@b.co', reason: 'disabled' } }),
    )
    expect(disabled.detail).toBe('a@b.co · 비활성 계정')
    expect(disabled.tone).toBe('warning')
  })

  it('계정 수정은 바뀐 칸을 우리말로 적고 등급 변화를 보여 준다', () => {
    const view = auditView(
      event({
        kind: 'admin.user_updated',
        detail: {
          fields: ['role', 'password'],
          before: { role: 'member', active: true },
          after: { role: 'lead', active: true },
        },
      }),
    )
    // 등급은 값까지 보여 주므로 칸 이름 쪽에서는 빠진다. 두 번 말하지 않는다.
    expect(view.detail).toBe('임시 비밀번호 · 등급 사원 → 팀장')
  })

  it('비활성화는 등급이 그대로여도 드러난다', () => {
    const view = auditView(
      event({
        kind: 'admin.user_updated',
        detail: {
          fields: ['active'],
          before: { role: 'member', active: true },
          after: { role: 'member', active: false },
        },
      }),
    )
    expect(view.detail).toBe('비활성화')
  })

  it('권한 거부는 어디서 무엇이 모자랐는지 적는다', () => {
    const view = auditView(
      event({
        kind: 'acl.denied',
        detail: { path: '/api/boards/exec/posts', min_role: 'exec', role: 'member' },
      }),
    )
    expect(view.detail).toBe('/api/boards/exec/posts · 임원 이상 필요, 현재 사원')
    expect(view.tone).toBe('warning')
  })

  it('detail 이 없어도 부연만 비고 줄은 남는다', () => {
    const view = auditView(event({ kind: 'admin.user_updated', detail: null }))
    expect(view.summary).toBe('계정 수정')
    expect(view.detail).toBe('')
  })

  it('세션 토큰 재사용은 가장 센 색으로 표시한다', () => {
    expect(auditView(event({ kind: 'auth.refresh_reuse' })).tone).toBe('danger')
  })
})
