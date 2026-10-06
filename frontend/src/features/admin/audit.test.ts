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
  // 백엔드가 남기는 종류를 화면이 모르면 `approvals.decided` 같은 식별자가 그대로 보인다.
  it('결재·근태·휴일 기록을 읽을 수 있는 말로 바꾼다', () => {
    expect(
      auditView(event({ kind: 'approvals.decided', detail: { step: 2, action: 'reject' } })),
    ).toMatchObject({ summary: '결재 반려', detail: '2단계', tone: 'warning' })
    expect(
      auditView(
        event({
          kind: 'approvals.decided',
          detail: { step: 1, action: 'approve', acting_for: 'u-3' },
        }),
      ),
    ).toMatchObject({ summary: '결재 승인', detail: '1단계 · 대결' })
    expect(
      auditView(event({ kind: 'approvals.force_closed', detail: { reason: '중복 상신' } })),
    ).toMatchObject({ summary: '결재 강제 종결', detail: '중복 상신' })
    expect(
      auditView(
        event({
          kind: 'approvals.delegation_created',
          detail: { start_date: '2026-10-08', end_date: '2026-10-10', type_code: null },
        }),
      ).detail,
    ).toBe('2026-10-08 ~ 2026-10-10 · 모든 유형')
    expect(
      auditView(event({ kind: 'approvals.auto_approved', detail: { type_code: 'leave' } })).detail,
    ).toBe('휴가 · 결재선 없음')
    expect(
      auditView(
        event({ kind: 'attendance.reopened', detail: { month: '2026-09', reason: '정정' } }),
      ),
    ).toMatchObject({ summary: '근태 월 마감 해제', detail: '2026-09 · 정정', tone: 'warning' })
    expect(
      auditView(
        event({
          kind: 'admin.holiday_updated',
          detail: { date: '2026-10-09', from: '창립일', to: '창립기념일' },
        }),
      ).detail,
    ).toBe('2026-10-09 · 창립일 → 창립기념일')
    expect(
      auditView(event({ kind: 'admin.calendar_rebuilt', detail: { year: 2027, workdays: 249 } }))
        .detail,
    ).toBe('2027년 · 근무일 249일')
  })

  it('게시판·문서·채팅 기록. 채팅 본문은 그리지 않는다', () => {
    expect(
      auditView(
        event({
          kind: 'boards.attachments_changed',
          detail: { post_id: 'p-1', added: ['/a', '/b'], removed: [] },
        }),
      ),
    ).toMatchObject({ summary: '게시글 첨부 변경', detail: '2개 붙임' })
    // 쓴 사람과 지운 사람이 다르면 임원이 남의 댓글을 지운 것이다.
    expect(
      auditView(
        event({ kind: 'boards.comment_deleted', detail: { author_id: 'u-9', preview: '안녕' } }),
      ).summary,
    ).toBe('남의 게시글 댓글 삭제')
    expect(
      auditView(
        event({ kind: 'boards.comment_deleted', detail: { author_id: 'u-1', preview: '안녕' } }),
      ),
    ).toMatchObject({ summary: '게시글 댓글 삭제', detail: '안녕' })
    expect(
      auditView(event({ kind: 'channels.members_changed', detail: { removed: ['u-2'] } })),
    ).toMatchObject({ summary: '채널에서 내보냄', detail: '1명' })
    expect(
      auditView(
        event({
          kind: 'channels.members_changed',
          detail: { created: true, added: ['u-1', 'u-2'] },
        }),
      ).summary,
    ).toBe('비공개 채널 생성')
    const deleted = auditView(
      event({
        kind: 'chat.message_deleted',
        detail: { preview: '둘만 아는 말', attachments: ['/f'] },
      }),
    )
    expect(deleted).toMatchObject({ summary: '채팅 메시지 삭제', detail: '1개 첨부' })
    expect(JSON.stringify(deleted)).not.toContain('둘만 아는 말')
    expect(
      auditView(event({ kind: 'docs.folder_deleted', detail: { title: '회의록' } })),
    ).toMatchObject({ summary: '폴더 삭제', detail: '회의록' })
  })

  it('모르는 종류는 종류 이름을 그대로 보여 준다', () => {
    // 줄이 사라지거나 빈칸이 되면 "무슨 일이 있었는지 다 남는다" 는 전제가 깨진다.
    const view = auditView(event({ kind: 'approvals.something_new' }))
    expect(view.summary).toBe('approvals.something_new')
  })

  it('CRM 기관 삭제는 사유를, 개인정보 삭제는 종류만 보여 준다', () => {
    const org = auditView(
      event({ kind: 'crm.org_deleted', detail: { name: '한결연금공단', reason: '중복 등록' } }),
    )
    expect(org).toMatchObject({
      summary: 'CRM 기관 삭제',
      detail: '한결연금공단 · 중복 등록',
      tone: 'warning',
    })
    expect(auditView(event({ kind: 'crm.activity_deleted' })).summary).toBe('CRM 활동 기록 삭제')
    expect(auditView(event({ kind: 'crm.contact_erased' })).summary).toBe(
      'CRM 담당자 개인정보 삭제',
    )
    expect(
      auditView(event({ kind: 'crm.deal_deleted', detail: { name: '잘못 만든 안건' } })),
    ).toMatchObject({ summary: 'CRM 안건 삭제', detail: '잘못 만든 안건' })
    expect(auditView(event({ kind: 'crm.contact_deleted' })).summary).toBe('CRM 담당자 삭제')
    expect(
      auditView(
        event({
          kind: 'crm.import_undone',
          detail: { removed_orgs: 2, removed_contacts: 5, kept_orgs: 0, kept_contacts: 1 },
        }),
      ),
    ).toMatchObject({ summary: 'CRM 가져오기 되돌리기', detail: '2곳 · 5명' })
    expect(
      auditView(event({ kind: 'crm.org_restored', detail: { name: '한결연금공단' } })),
    ).toMatchObject({ summary: 'CRM 기관 되살리기', detail: '한결연금공단' })
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
    expect(view.detail).toBeUndefined()
  })

  it('팀 생성·이름 변경은 우리말로 적는다', () => {
    const created = auditView(event({ kind: 'admin.team_created', detail: { name: '기획팀' } }))
    expect(created.summary).toBe('팀 생성')
    expect(created.detail).toBe('기획팀')

    const updated = auditView(
      event({ kind: 'admin.team_updated', detail: { before: '개발팀', after: '플랫폼팀' } }),
    )
    expect(updated.summary).toBe('팀 이름 변경')
    expect(updated.detail).toBe('개발팀 → 플랫폼팀')
  })

  it('세션 토큰 재사용은 가장 센 색으로 표시한다', () => {
    expect(auditView(event({ kind: 'auth.refresh_reuse' })).tone).toBe('danger')
  })
})
