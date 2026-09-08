import type {
  ApprovalBox,
  ApprovalDocument,
  ApprovalListItem,
  ApprovalStep,
  ApprovalType,
  DraftInput,
  Person,
} from '@/features/approvals/types'
import type { User } from '@/types'
import { DEMO_ACCOUNTS } from './accounts'
import { MOCK_USERS } from './db'

/** 13 §4.1 `approval_types` 시드. 기본 결재선은 13 §5.2. */
export const APPROVAL_TYPES: ApprovalType[] = [
  { code: 'leave', name: '휴가', default_steps: 1, allow_delegate_decision: true },
  { code: 'arrangement', name: '예외 근무', default_steps: 1, allow_delegate_decision: false },
  { code: 'overtime', name: '연장근로', default_steps: 1, allow_delegate_decision: false },
  { code: 'correction', name: '근태 정정', default_steps: 1, allow_delegate_decision: false },
  { code: 'general', name: '일반 기안', default_steps: 2, allow_delegate_decision: true },
]

const person = (u: User): Person => ({ id: u.id, name: u.name })
const userById = (id: string) => MOCK_USERS.find((u) => u.id === id)

/**
 * 결재선 자동 생성(13 §5.2): 일반 기안은 팀장 → 임원. 기안자 본인 단계는 건너뛴다.
 * 이 회사에는 팀장 직급이 없다(조직도 2026-09-08). 그래서 임원 두 단계, 직급 순으로
 * 전무(신준희) → 대표(김철성)로 둔다(목 가정, PR 본문). 임원이 기안하면 결재선이 비어
 * 즉시 확정된다(13 TC-APV-04).
 */
const APPROVER_IDS = ['u-11', 'u-12']

function buildSteps(drafter: User): ApprovalStep[] {
  // 임원 기안은 결재선이 없다(13 §5.2). 아랫사람에게 결재를 받지 않는다.
  if (drafter.role === 'exec') return []
  const lead = MOCK_USERS.find(
    (u) => u.role === 'lead' && u.team?.id === drafter.team?.id && u.id !== drafter.id,
  )
  const approvers = [lead, ...APPROVER_IDS.map(userById)].filter(
    (u): u is User => !!u && u.id !== drafter.id,
  )
  return approvers.map((u, i) => ({
    step_no: i + 1,
    approver: person(u),
    acted_by: null,
    role: 'approve',
    status: 'waiting',
    comment: null,
    acted_at: null,
    version: 1,
  }))
}

interface Stored extends ApprovalDocument {
  drafter_id: string
}

const docs: Stored[] = []
let seq = 1
const now = () => new Date().toISOString()
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()

/** 저장 행 → 응답. `drafter_id` 는 목 내부용이라 뺀다. */
function expose(doc: Stored): ApprovalDocument {
  const copy: Partial<Stored> = { ...doc }
  delete copy.drafter_id
  return copy as ApprovalDocument
}

function summarize(doc: Stored): ApprovalListItem {
  const copy: Partial<ApprovalDocument> = expose(doc)
  delete copy.subject
  delete copy.steps
  delete copy.closed_at
  return copy as ApprovalListItem
}

function currentOf(doc: Stored) {
  const step = doc.steps.find((s) => s.status === 'waiting')
  doc.current_step = doc.status === 'pending' && step ? step.step_no : null
  doc.waiting_on = doc.status === 'pending' && step ? step.approver : null
}

/** 문서를 닫는다. 아직 차례가 안 온 단계는 `skipped`(13 §6.2). "대기"로 남기면 끝난 문서가 진행 중처럼 보인다. */
function close(doc: Stored, status: 'approved' | 'rejected' | 'canceled', at = now()) {
  doc.status = status
  doc.closed_at = at
  for (const step of doc.steps) if (step.status === 'waiting') step.status = 'skipped'
  currentOf(doc)
}

function create(drafter: User, input: DraftInput, at = now()): Stored {
  const doc: Stored = {
    id: `apv-${seq++}`,
    type_code: input.type_code,
    drafter: person(drafter),
    drafter_id: drafter.id,
    title: input.title.trim(),
    status: 'draft',
    current_step: null,
    waiting_on: null,
    submitted_at: null,
    closed_at: null,
    created_at: at,
    amount: input.subject.amount,
    related: input.subject.related,
    subject: input.subject,
    steps: [],
  }
  docs.push(doc)
  return doc
}

function submit(doc: Stored, at = now()) {
  const drafter = userById(doc.drafter_id)
  doc.steps = drafter ? buildSteps(drafter) : []
  doc.submitted_at = at
  if (doc.steps.length === 0) {
    // 대표 기안: 결재선 없음 → 즉시 확정. 문서와 이력은 남는다.
    close(doc, 'approved', at)
  } else {
    doc.status = 'pending'
    currentOf(doc)
  }
}

function approveStep(step: ApprovalStep, comment: string | null, at: string) {
  step.status = 'approved'
  step.comment = comment
  step.acted_at = at
  step.version += 1
}

/** 시연 시드. 로그인 바로가기 계정에게만 깐다. 사원에게는 보낸 결재, 대표에게는 받은 결재가 생긴다. */
let seeded = false
function seed() {
  if (seeded) return
  seeded = true
  const member = MOCK_USERS.find((u) => u.email === DEMO_ACCOUNTS[0].email)
  if (!member) return
  const older = create(
    member,
    {
      type_code: 'general',
      title: '노트북 거치대 구매 품의',
      subject: {
        body: '재택 근무자용 거치대 3개. 견적서 첨부 예정.',
        amount: 87_000,
        related: null,
      },
    },
    daysAgo(9),
  )
  submit(older, daysAgo(9))
  approveStep(older.steps[0], null, daysAgo(8))
  approveStep(older.steps[1], '승인합니다.', daysAgo(7))
  close(older, 'approved', daysAgo(7))

  // 전무는 이미 승인했고 대표 차례. 대표 계정으로 들어오면 받은 결재함에 뜬다.
  const pending = create(
    member,
    {
      type_code: 'general',
      title: '9월 워크숍 장소 대관 지출',
      subject: { body: '9/19 워크숍 세미나실 대관료.', amount: 450_000, related: null },
    },
    daysAgo(1),
  )
  submit(pending, daysAgo(1))
  approveStep(pending.steps[0], null, daysAgo(0.5))
  currentOf(pending)
}

export function listApprovals(user: User, box: ApprovalBox): ApprovalListItem[] {
  seed()
  const mine = docs.filter((d) => {
    if (box === 'draft') return d.drafter_id === user.id && d.status === 'draft'
    if (box === 'sent') return d.drafter_id === user.id && d.status !== 'draft'
    if (box === 'inbox') return d.status === 'pending' && d.waiting_on?.id === user.id
    return d.steps.some((s) => s.role === 'reference' && s.approver.id === user.id)
  })
  return mine
    .sort((a, b) => (b.submitted_at ?? b.created_at).localeCompare(a.submitted_at ?? a.created_at))
    .map(summarize)
}

type Failure = { error: string; status: number; code: string }
const fail = (error: string, status: number, code: string): Failure => ({ error, status, code })

/** 열람은 기안자 · 결재선상의 사람 · exec(전사 조회, 13 §3)만. */
export function getApproval(user: User, id: string): ApprovalDocument | Failure {
  seed()
  const doc = docs.find((d) => d.id === id)
  if (!doc) return fail('문서를 찾을 수 없습니다.', 404, 'NOT_FOUND')
  const related =
    doc.drafter_id === user.id ||
    doc.steps.some((s) => s.approver.id === user.id) ||
    user.role === 'exec'
  if (!related) return fail('열람 권한이 없습니다.', 403, 'FORBIDDEN')
  return expose(doc)
}

/** 생성·갱신이 같은 검증을 탄다. 어느 경로로 들어와도 서버는 같은 것을 막는다. */
function validate(input: DraftInput): Failure | null {
  if (input.type_code !== 'general')
    return fail('v1 은 일반 기안만 기안할 수 있습니다.', 422, 'VALIDATION')
  if (!input.title?.trim()) return fail('제목을 입력해 주세요.', 422, 'VALIDATION')
  if (input.subject.amount !== null && !(input.subject.amount >= 0)) {
    return fail('금액이 올바르지 않습니다.', 422, 'VALIDATION')
  }
  return null
}

export function createDraft(user: User, input: DraftInput): ApprovalDocument | Failure {
  seed()
  const invalid = validate(input)
  if (invalid) return invalid
  return expose(create(user, input))
}

export function updateDraft(user: User, id: string, input: DraftInput): ApprovalDocument | Failure {
  const doc = docs.find((d) => d.id === id)
  if (!doc || doc.drafter_id !== user.id) return fail('문서를 찾을 수 없습니다.', 404, 'NOT_FOUND')
  if (doc.status !== 'draft') return fail('상신한 문서는 고칠 수 없습니다.', 409, 'NOT_DRAFT')
  const invalid = validate(input)
  if (invalid) return invalid
  doc.title = input.title.trim()
  doc.subject = input.subject
  doc.amount = input.subject.amount
  doc.related = input.subject.related
  return expose(doc)
}

export function submitApproval(user: User, id: string): ApprovalDocument | Failure {
  const doc = docs.find((d) => d.id === id)
  if (!doc || doc.drafter_id !== user.id) return fail('문서를 찾을 수 없습니다.', 404, 'NOT_FOUND')
  if (doc.status !== 'draft') return fail('이미 상신한 문서입니다.', 409, 'NOT_DRAFT')
  if (!doc.subject.body.trim()) return fail('본문을 입력해 주세요.', 422, 'VALIDATION')
  submit(doc)
  return expose(doc)
}

/** 회수. 승인된 단계가 있으면 409(13 FR-APV-06). */
export function cancelApproval(user: User, id: string): ApprovalDocument | Failure {
  const doc = docs.find((d) => d.id === id)
  if (!doc || doc.drafter_id !== user.id) return fail('문서를 찾을 수 없습니다.', 404, 'NOT_FOUND')
  if (doc.status !== 'pending')
    return fail('대기 중인 문서만 회수할 수 있습니다.', 409, 'NOT_PENDING')
  if (doc.steps.some((s) => s.status === 'approved')) {
    return fail(
      '이미 승인된 단계가 있어 회수할 수 없습니다. 반려를 요청하세요.',
      409,
      'STEP_APPROVED',
    )
  }
  close(doc, 'canceled')
  return expose(doc)
}

/**
 * 승인·반려. 내 차례인 단계만, `version` 이 맞을 때만(13 §4.2.5). 두 탭에서 동시에 누르면 하나만 성공.
 */
export function decide(
  user: User,
  id: string,
  action: 'approve' | 'reject',
  version: number,
  text: string | undefined,
): ApprovalDocument | Failure {
  const doc = docs.find((d) => d.id === id)
  if (!doc) return fail('문서를 찾을 수 없습니다.', 404, 'NOT_FOUND')
  const step = doc.steps.find((s) => s.status === 'waiting')
  if (doc.status !== 'pending' || !step || step.approver.id !== user.id) {
    return fail('처리할 차례가 아닙니다.', 403, 'NOT_YOUR_TURN')
  }
  if (step.version !== version)
    return fail('문서가 그새 바뀌었습니다. 새로고침해 주세요.', 409, 'VERSION_CONFLICT')
  if (action === 'reject' && !text?.trim())
    return fail('반려 사유를 입력해 주세요.', 400, 'REASON_REQUIRED')
  const at = now()
  if (action === 'reject') {
    step.status = 'rejected'
    step.comment = text?.trim() || null
    step.acted_at = at
    step.version += 1
    close(doc, 'rejected', at)
  } else {
    approveStep(step, text?.trim() || null, at)
    if (doc.steps.some((s) => s.status === 'waiting')) currentOf(doc)
    else close(doc, 'approved', at)
  }
  return expose(doc)
}
