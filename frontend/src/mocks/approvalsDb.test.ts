import { describe, expect, it } from 'vitest'
import { MOCK_USERS } from './db'
import {
  cancelApproval,
  createDelegation,
  createDraft,
  deleteDelegation,
  decide,
  forceClose,
  getApproval,
  listApprovals,
  listDelegations,
  submitApproval,
  updateDraft,
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

describe('참조자 (13 FR-APV-16)', () => {
  it('상신 전에는 참조자에게 안 보이고, 상신하면 참조함에 들어간다', () => {
    const draft = createDraft(member, {
      type_code: 'general',
      title: '참조 시험',
      subject: { body: '본문', amount: null, related: null },
      references: [other.id],
    })
    if ('error' in draft) throw new Error(draft.error)

    // 기안자가 아직 고쳐 쓰는 중이다.
    expect(listApprovals(other, 'reference').map((d) => d.id)).not.toContain(draft.id)

    const pending = submitApproval(member, draft.id)
    if ('error' in pending) throw new Error(pending.error)
    expect(listApprovals(other, 'reference').map((d) => d.id)).toContain(draft.id)
  })

  it('참조는 결재 차례를 가로채지 않는다', () => {
    const draft = createDraft(member, {
      type_code: 'general',
      title: '참조가 결재를 막지 않는다',
      subject: { body: '본문', amount: null, related: null },
      references: [other.id],
    })
    if ('error' in draft) throw new Error(draft.error)
    const pending = submitApproval(member, draft.id)
    if ('error' in pending) throw new Error(pending.error)

    // 결재선은 전무 → 대표. 참조자는 그 뒤에 붙고 대기 사슬에 들어가지 않는다.
    expect(pending.waiting_on?.id).toBe(senior.id)
    expect(pending.steps.map((s) => s.role)).toEqual(['approve', 'approve', 'reference'])
    expect(pending.steps.at(-1)?.approver.id).toBe(other.id)

    const done = decide(senior, pending.id, 'approve', 1, undefined)
    if ('error' in done) throw new Error(done.error)
    expect(done.waiting_on?.id).toBe(ceo.id)
  })

  it('참조자만 있고 결재자가 없는 임원 기안은 그대로 확정된다', () => {
    // 참조는 결재선이 아니다. 개수로 재면 아무도 처리할 수 없는 문서가 대기로 남는다.
    const draft = createDraft(ceo, {
      type_code: 'general',
      title: '임원 기안에 참조만',
      subject: { body: '본문', amount: null, related: null },
      references: [member.id],
    })
    if ('error' in draft) throw new Error(draft.error)

    const done = submitApproval(ceo, draft.id)
    if ('error' in done) throw new Error(done.error)
    expect(done.status).toBe('approved')
    expect(done.waiting_on).toBeNull()
    expect(listApprovals(member, 'reference').map((d) => d.id)).toContain(draft.id)
  })

  it('임시저장을 고치면 참조자가 바뀐다', () => {
    const draft = createDraft(member, {
      type_code: 'general',
      title: '참조 교체',
      subject: { body: '본문', amount: null, related: null },
      references: [other.id],
    })
    if ('error' in draft) throw new Error(draft.error)

    const updated = updateDraft(member, draft.id, {
      type_code: 'general',
      title: '참조 교체',
      subject: { body: '본문', amount: null, related: null },
      references: [ceo.id],
    })
    if ('error' in updated) throw new Error(updated.error)
    expect(updated.steps.map((s) => s.approver.id)).toEqual([ceo.id])
  })
})

describe('참조자 검증과 겹침', () => {
  it('결재자·기안자는 참조에서 빠진다', () => {
    // 결재선은 상신할 때 정해져서 화면이 미리 거를 수 없다. 서버가 거른다.
    const draft = createDraft(member, {
      type_code: 'general',
      title: '결재자를 참조로',
      subject: { body: '본문', amount: null, related: null },
      references: [senior.id, other.id],
    })
    if ('error' in draft) throw new Error(draft.error)
    const pending = submitApproval(member, draft.id)
    if ('error' in pending) throw new Error(pending.error)

    const references = pending.steps.filter((s) => s.role === 'reference')
    expect(references.map((s) => s.approver.id)).toEqual([other.id])
    // 같은 사람이 결재선에 두 줄로 서면 받은 결재함과 참조함에 같이 뜬다.
    expect(listApprovals(senior, 'reference').map((d) => d.id)).not.toContain(draft.id)
  })

  it('없는 사람·겹친 사람·배열이 아닌 값은 422 다', () => {
    const base = {
      type_code: 'general' as const,
      title: '참조 검증',
      subject: { body: '본문', amount: null, related: null },
    }
    expect(createDraft(member, { ...base, references: ['u-없음'] })).toMatchObject({
      code: 'VALIDATION',
    })
    expect(createDraft(member, { ...base, references: [other.id, other.id] })).toMatchObject({
      code: 'VALIDATION',
    })
    expect(
      createDraft(member, { ...base, references: other.id as unknown as string[] }),
    ).toMatchObject({ code: 'VALIDATION' })
  })

  it('참조자는 상신 전 초안을 열 수 없다', () => {
    const draft = createDraft(member, {
      type_code: 'general',
      title: '초안 열람',
      subject: { body: '본문', amount: null, related: null },
      references: [other.id],
    })
    if ('error' in draft) throw new Error(draft.error)

    // 주소만 바꿔 들어와도 막힌다. 목록에서 빼는 것만으로는 부족하다.
    expect(getApproval(other, draft.id)).toMatchObject({ code: 'FORBIDDEN' })

    submitApproval(member, draft.id)
    expect(getApproval(other, draft.id)).toMatchObject({ id: draft.id })
  })
})

describe('결재 위임 (13 §4.2.3)', () => {
  const today = new Date().toISOString().slice(0, 10)
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)

  it('자기 자신·거꾸로 된 기간·위임 못 하는 유형은 막는다', () => {
    expect(
      createDelegation(senior, { delegate_id: senior.id, start_date: today, end_date: tomorrow }),
    ).toMatchObject({ code: 'VALIDATION' })
    expect(
      createDelegation(senior, { delegate_id: ceo.id, start_date: tomorrow, end_date: today }),
    ).toMatchObject({ code: 'VALIDATION' })
    // 유형마다 위임 가능 여부가 다르다. 예외 근무는 꺼져 있다.
    expect(
      createDelegation(senior, {
        delegate_id: ceo.id,
        start_date: today,
        end_date: tomorrow,
        type_code: 'arrangement',
      }),
    ).toMatchObject({ code: 'DELEGATE_NOT_ALLOWED' })
  })

  it('위임받은 사람이 결재하면 원 결재자 이름이 남고 대결로 표시된다', () => {
    const made = createDelegation(senior, {
      delegate_id: other.id,
      start_date: today,
      end_date: tomorrow,
    })
    if ('error' in made) throw new Error(made.error)

    const doc = draftAndSubmit('위임 결재 시험')
    expect(doc.waiting_on?.id).toBe(senior.id)

    // 위임받은 사람이 대신 누른다. 차례는 여전히 전무 것이다.
    const acted = decide(other, doc.id, 'approve', 1, undefined)
    if ('error' in acted) throw new Error(acted.error)
    expect(acted.steps[0]).toMatchObject({
      approver: { id: senior.id },
      acted_by: { id: other.id },
      status: 'delegated_done',
    })

    // 기간이 겹치는 위임은 하나뿐이어야 한다. 누가 대신할지가 갈린다.
    expect(
      createDelegation(senior, {
        delegate_id: ceo.id,
        start_date: today,
        end_date: tomorrow,
      }),
    ).toMatchObject({ code: 'CONFLICT' })

    // 해제하면 다시 아무나 못 누른다.
    const gone = deleteDelegation(senior, made.id)
    expect(gone).toBeNull()
    const next = draftAndSubmit('위임 해제 뒤')
    expect(decide(other, next.id, 'approve', 1, undefined)).toMatchObject({
      code: 'NOT_YOUR_TURN',
    })
  })

  it('기간이 지난 위임으로는 대신 결재할 수 없다', () => {
    const made = createDelegation(ceo, {
      delegate_id: other.id,
      start_date: yesterday,
      end_date: yesterday,
    })
    if ('error' in made) throw new Error(made.error)

    const doc = draftAndSubmit('지난 위임')
    decide(senior, doc.id, 'approve', 1, undefined)
    expect(decide(other, doc.id, 'approve', 1, undefined)).toMatchObject({ code: 'NOT_YOUR_TURN' })
    deleteDelegation(ceo, made.id)
  })

  it('내가 건 위임만 보인다', () => {
    const made = createDelegation(senior, {
      delegate_id: other.id,
      start_date: today,
      end_date: tomorrow,
    })
    if ('error' in made) throw new Error(made.error)
    expect(listDelegations(senior).map((d) => d.id)).toContain(made.id)
    expect(listDelegations(other)).toHaveLength(0)
    // 남의 위임은 해제도 못 한다.
    expect(deleteDelegation(other, made.id)).toMatchObject({ code: 'NOT_FOUND' })
    deleteDelegation(senior, made.id)
  })
})
