import { describe, expect, it } from 'vitest'
import { toISODate } from '@/lib/datetime'
import { MOCK_USERS } from './db'
import {
  attachmentPrefix,
  cancelApproval,
  checkAttachTarget,
  checkAttachmentDownload,
  createDelegation,
  createDraft,
  deleteDelegation,
  deleteDraft,
  decide,
  forceClose,
  getApproval,
  listApprovals,
  listDelegations,
  recordAttachment,
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
  // 목과 같은 로컬 기준으로 만든다. UTC 로 만들면 한국에서 아침마다 하루가 밀려,
  // 목이 UTC 로 재던 시절의 버그를 테스트도 같이 놓친다.
  const day = (offset: number) => toISODate(new Date(Date.now() + offset * 86_400_000))
  const today = day(0)
  const tomorrow = day(1)
  const yesterday = day(-1)

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
    ).toMatchObject({ code: 'DELEGATION_OVERLAP' })

    // 해제하면 다시 아무나 못 누른다.
    const gone = deleteDelegation(senior, made.id)
    expect(gone).toBeNull()
    const next = draftAndSubmit('위임 해제 뒤')
    expect(decide(other, next.id, 'approve', 1, undefined)).toMatchObject({
      code: 'NOT_YOUR_TURN',
    })
  })

  it('위임받은 사람의 받은 결재함에 문서가 뜨고, 열 수 있고, 처리 가능 표시가 붙는다', () => {
    // 이 셋이 따로 놀면 위임을 걸어도 그 사람은 문서에 닿지 못한다.
    const made = createDelegation(senior, {
      delegate_id: other.id,
      start_date: today,
      end_date: tomorrow,
    })
    if ('error' in made) throw new Error(made.error)

    const doc = draftAndSubmit('위임 도달 경로')
    expect(listApprovals(other, 'inbox').map((d) => d.id)).toContain(doc.id)

    const opened = getApproval(other, doc.id)
    if ('error' in opened) throw new Error(opened.error)
    expect(opened.can_decide).toBe(true)
    // 남의 차례를 대신 누르는 것이지 그 사람이 된 것은 아니다. 다른 문서는 여전히 못 본다.
    expect(getApproval(other, doc.id)).toMatchObject({ waiting_on: { id: senior.id } })

    deleteDelegation(senior, made.id)
    expect(listApprovals(other, 'inbox').map((d) => d.id)).not.toContain(doc.id)
    expect(getApproval(other, doc.id)).toMatchObject({ code: 'FORBIDDEN' })
  })

  it('대신 눌러 준 문서는 그 뒤에도 볼 수 있다', () => {
    // 누르자마자 다음 차례로 넘어가므로, 처리 자격만 보면 방금 승인한 문서를 바로 잃는다.
    const made = createDelegation(senior, {
      delegate_id: other.id,
      start_date: today,
      end_date: tomorrow,
    })
    if ('error' in made) throw new Error(made.error)

    const doc = draftAndSubmit('대결 뒤 열람')
    decide(other, doc.id, 'approve', 1, undefined)
    deleteDelegation(senior, made.id)

    const seen = getApproval(other, doc.id)
    if ('error' in seen) throw new Error(seen.error)
    expect(seen.can_decide).toBe(false)
  })

  it('대결로 승인한 뒤에는 기안자가 회수할 수 없다', () => {
    const made = createDelegation(senior, {
      delegate_id: other.id,
      start_date: today,
      end_date: tomorrow,
    })
    if ('error' in made) throw new Error(made.error)

    const doc = draftAndSubmit('대결 뒤 회수')
    decide(other, doc.id, 'approve', 1, undefined)
    // 대결 승인은 `delegated_done` 이라 `approved` 만 보면 빠져나간다.
    expect(cancelApproval(member, doc.id)).toMatchObject({ code: 'STEP_APPROVED' })
    deleteDelegation(senior, made.id)
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

describe('결재 첨부 (13 FR-APV-05)', () => {
  const subject = { body: '본문', amount: 1000, related: null }
  let fileSeq = 0
  /** 목 핸들러가 하는 일: 문서에 파일을 올리고 그 주인을 적는다. */
  function upload(docId: string, name = 'receipt.png') {
    const fileId = `a-test-${fileSeq++}`
    recordAttachment(docId, fileId)
    return {
      url: `${attachmentPrefix(docId)}${fileId}/${name}`,
      name,
      size: 10,
      content_type: null,
    }
  }

  function draftWithFile(references?: string[]) {
    const draft = createDraft(member, {
      type_code: 'general',
      title: '영수증',
      subject,
      references,
    })
    if ('error' in draft) throw new Error(draft.error)
    const updated = updateDraft(member, draft.id, {
      type_code: 'general',
      title: '영수증',
      subject: { ...subject, attachments: [upload(draft.id)] },
    })
    if ('error' in updated) throw new Error(updated.error)
    return { doc: updated, url: updated.subject.attachments![0].url }
  }

  it('새로 만들 때는 첨부를 받지 않는다. 아직 올릴 문서가 없다', () => {
    const made = createDraft(member, {
      type_code: 'general',
      title: '영수증',
      subject: { ...subject, attachments: [upload('apv-1')] },
    })
    expect(made).toMatchObject({ status: 422, code: 'VALIDATION' })
  })

  it('남의 문서에 올린 파일은 url 을 통째로 옮겨도, 파일 id 만 내 경로에 끼워도 못 붙인다', () => {
    const { doc: mine, url } = draftWithFile()
    const other = createDraft(member, { type_code: 'general', title: '다른 문서', subject })
    if ('error' in other) throw new Error(other.error)
    const attach = (fileUrl: string) =>
      updateDraft(member, other.id, {
        type_code: 'general',
        title: '다른 문서',
        subject: { ...subject, attachments: [{ url: fileUrl, name: 'x', size: 1 }] },
      })
    expect(attach(url)).toMatchObject({ status: 422, code: 'VALIDATION' })
    const fileId = url.slice(attachmentPrefix(mine.id).length).split('/')[0]
    expect(attach(`${attachmentPrefix(other.id)}${fileId}/x`)).toMatchObject({ status: 422 })
  })

  it('올리기는 내 임시저장에만 된다', () => {
    const { doc } = draftWithFile()
    expect(checkAttachTarget(member, doc.id)).toBeNull()
    expect(checkAttachTarget(other, doc.id)).toMatchObject({ status: 404 })
    submitApproval(member, doc.id)
    expect(checkAttachTarget(member, doc.id)).toMatchObject({ status: 409, code: 'NOT_DRAFT' })
  })

  it('내려받기는 문서를 열 수 있는 사람만, 붙어 있는 파일만', () => {
    const { doc, url } = draftWithFile()
    expect(checkAttachmentDownload(member, doc.id, url)).toBeNull()
    expect(checkAttachmentDownload(other, doc.id, url)).toMatchObject({ status: 403 })
    expect(checkAttachmentDownload(ceo, doc.id, url)).toBeNull() // 임원 전사 조회
    expect(
      checkAttachmentDownload(member, doc.id, upload(doc.id, 'removed.png').url),
    ).toMatchObject({ status: 404 })
  })

  it('참조자는 상신한 뒤에만 받는다. 기안자가 아직 고쳐 쓰는 중이다', () => {
    const { doc, url } = draftWithFile([other.id])
    expect(checkAttachmentDownload(other, doc.id, url)).toMatchObject({ status: 403 })
    submitApproval(member, doc.id)
    expect(checkAttachmentDownload(other, doc.id, url)).toBeNull()
  })

  it('위임받은 사람은 대신 결재할 차례에 받는다', () => {
    const { doc, url } = draftWithFile()
    submitApproval(member, doc.id) // 첫 차례는 전무
    expect(checkAttachmentDownload(other, doc.id, url)).toMatchObject({ status: 403 })
    const today = toISODate(new Date())
    const made = createDelegation(senior, {
      delegate_id: other.id,
      start_date: today,
      end_date: today,
    })
    if ('error' in made) throw new Error(made.error)
    expect(checkAttachmentDownload(other, doc.id, url)).toBeNull()
    deleteDelegation(senior, made.id)
  })
})

describe('임시저장 지우기', () => {
  it('내 임시저장만 지워지고, 상신한 문서와 남의 문서는 남는다', () => {
    const draft = createDraft(member, {
      type_code: 'general',
      title: '지울 임시저장',
      subject: { body: '본문', amount: null, related: null },
    })
    if ('error' in draft) throw new Error(draft.error)

    // 남의 임시저장은 있는지조차 알려 주지 않는다.
    expect(deleteDraft(other, draft.id)).toMatchObject({ status: 404 })
    expect(deleteDraft(member, draft.id)).toBeNull()
    expect(listApprovals(member, 'draft').some((d) => d.id === draft.id)).toBe(false)
    // 같은 요청을 다시 보내면 없는 문서다.
    expect(deleteDraft(member, draft.id)).toMatchObject({ status: 404 })

    // 상신한 문서는 이력이라 지우지 않는다.
    const pending = draftAndSubmit('상신한 문서는 못 지운다')
    expect(deleteDraft(member, pending.id)).toMatchObject({ status: 409, code: 'NOT_DRAFT' })
    expect(getApproval(member, pending.id)).toMatchObject({ id: pending.id })
  })
})
