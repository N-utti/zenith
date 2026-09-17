import { describe, expect, it } from 'vitest'
import { MOCK_USERS } from './db'
import {
  cancelApproval,
  createDraft,
  decide,
  forceClose,
  listApprovals,
  submitApproval,
} from './approvalsDb'

const member = MOCK_USERS.find((u) => u.email === 'sungwoon@zenith.co.kr')!
const senior = MOCK_USERS.find((u) => u.id === 'u-11')! // 전무
const ceo = MOCK_USERS.find((u) => u.id === 'u-12')! // 대표
const other = MOCK_USERS.find((u) => u.id === 'u-7')!

function draftAndSubmit(title: string) {
  const draft = createDraft(member, {
    type_code: 'general',
    title,
    subject: { body: '본문', amount: 1000, related: null },
  })
  if ('error' in draft) throw new Error(draft.error)
  const pending = submitApproval(member, draft.id)
  if ('error' in pending) throw new Error(pending.error)
  return pending
}

describe('결재 목 저장소 (13 §5·§6·§9)', () => {
  it('사원의 시드 문서가 대표의 받은 결재함에 뜬다 (전무는 이미 승인)', () => {
    const inbox = listApprovals(ceo, 'inbox')
    expect(inbox.map((d) => d.title)).toContain('9월 워크숍 장소 대관 지출')
    expect(inbox.every((d) => d.waiting_on?.id === ceo.id)).toBe(true)
  })

  it('기안 → 상신 → 전무 → 대표 순으로 승인. 결재선은 상신 때 고정되고 마지막 승인에서 확정된다', () => {
    const pending = draftAndSubmit('테스트 기안')
    expect(pending.status).toBe('pending')
    expect(pending.steps.map((s) => s.approver.id)).toEqual([senior.id, ceo.id])
    expect(pending.waiting_on?.id).toBe(senior.id)

    // 차례가 아닌 사람은 403, 결재선 밖은 403, 낡은 version 은 409(13 §4.2.5).
    expect(decide(ceo, pending.id, 'approve', 1, undefined)).toMatchObject({
      code: 'NOT_YOUR_TURN',
    })
    expect(decide(other, pending.id, 'approve', 1, undefined)).toMatchObject({
      code: 'NOT_YOUR_TURN',
    })
    expect(decide(senior, pending.id, 'approve', 99, undefined)).toMatchObject({
      code: 'VERSION_CONFLICT',
    })

    const mid = decide(senior, pending.id, 'approve', 1, undefined)
    expect(mid).toMatchObject({ status: 'pending', current_step: 2 })
    expect(listApprovals(ceo, 'inbox').map((d) => d.id)).toContain(pending.id)

    const done = decide(ceo, pending.id, 'approve', 1, '좋습니다')
    expect(done).toMatchObject({ status: 'approved' })
    if ('error' in done) throw new Error(done.error)
    expect(done.steps.map((s) => s.status)).toEqual(['approved', 'approved'])
    expect(done.steps[1]).toMatchObject({ comment: '좋습니다', version: 2 })
    expect(listApprovals(ceo, 'inbox').map((d) => d.id)).not.toContain(pending.id)
  })

  it('승인된 단계가 있으면 회수 409(STEP_APPROVED), 없으면 회수되고 남은 단계는 skipped', () => {
    const a = draftAndSubmit('회수 테스트 A')
    decide(senior, a.id, 'approve', 1, undefined)
    expect(cancelApproval(member, a.id)).toMatchObject({ code: 'STEP_APPROVED' })

    const b = draftAndSubmit('회수 테스트 B')
    const canceled = cancelApproval(member, b.id)
    expect(canceled).toMatchObject({ status: 'canceled' })
    if ('error' in canceled) throw new Error(canceled.error)
    expect(canceled.steps.map((s) => s.status)).toEqual(['skipped', 'skipped'])
    expect(cancelApproval(member, b.id)).toMatchObject({ code: 'NOT_PENDING' })
  })

  it('반려는 사유가 없으면 400, 반려되면 뒤 단계는 skipped', () => {
    const doc = draftAndSubmit('반려 테스트')
    expect(decide(senior, doc.id, 'reject', 1, '')).toMatchObject({ code: 'REASON_REQUIRED' })
    const rejected = decide(senior, doc.id, 'reject', 1, '예산 없음')
    expect(rejected).toMatchObject({ status: 'rejected' })
    if ('error' in rejected) throw new Error(rejected.error)
    expect(rejected.steps.map((s) => s.status)).toEqual(['rejected', 'skipped'])
  })

  it('임원이 기안하면 결재선이 비어 즉시 확정된다 (TC-APV-04)', () => {
    const draft = createDraft(ceo, {
      type_code: 'general',
      title: '대표 기안',
      subject: { body: '본문', amount: null, related: null },
    })
    if ('error' in draft) throw new Error(draft.error)
    expect(submitApproval(ceo, draft.id)).toMatchObject({ status: 'approved', steps: [] })
  })
})

describe('강제 종결 (13 §9.2)', () => {
  it('임원만, 대기 중인 문서만, 사유가 있어야 끝낼 수 있다', () => {
    const doc = draftAndSubmit('강제 종결 대상')
    expect(forceClose(member, doc.id, '결재자 부재')).toMatchObject({ code: 'FORBIDDEN' })
    expect(forceClose(ceo, doc.id, '   ')).toMatchObject({ code: 'REASON_REQUIRED' })

    const draft = createDraft(member, {
      type_code: 'general',
      title: '아직 임시저장',
      subject: { body: '본문', amount: null, related: null },
    })
    if ('error' in draft) throw new Error(draft.error)
    expect(forceClose(ceo, draft.id, '사유')).toMatchObject({ code: 'NOT_PENDING' })
  })

  it('걸려 있던 단계에 사유와 처리자를 남기고 나머지 단계는 건너뛴다', () => {
    const doc = draftAndSubmit('결재자 퇴사 건')
    const closed = forceClose(ceo, doc.id, '결재자 퇴사로 더 받을 수 없음')
    if ('error' in closed) throw new Error(closed.error)

    expect(closed.status).toBe('closed')
    expect(closed.closed_at).not.toBeNull()
    expect(closed.current_step).toBeNull()
    // 문서에 사유 칸이 없다. 걸려 있던 단계에 적어야 누구 차례에서 왜 끊겼는지가 남는다.
    expect(closed.steps[0]).toMatchObject({
      comment: '결재자 퇴사로 더 받을 수 없음',
      acted_by: { id: ceo.id },
    })
    expect(closed.steps.some((s) => s.status === 'waiting')).toBe(false)

    // 끝난 문서는 또 끝낼 수 없고, 결재함에서도 빠진다.
    expect(forceClose(ceo, doc.id, '또')).toMatchObject({ code: 'NOT_PENDING' })
    expect(listApprovals(senior, 'inbox').map((d) => d.id)).not.toContain(doc.id)
  })
})
