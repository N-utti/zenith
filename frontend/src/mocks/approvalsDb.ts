import type {
  ApprovalBox,
  ApprovalTypeCode,
  Delegation,
  DelegationInput,
  ApprovalDocument,
  ApprovalListItem,
  ApprovalStep,
  ApprovalType,
  DraftInput,
  Person,
} from '@/features/approvals/types'
import { toISODate } from '@/lib/datetime'
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

/**
 * 참조 단계. 결재 차례가 아니라서 **대기 사슬에 넣지 않는다**(`status: 'skipped'`).
 *
 * 넣으면 `decide` 가 첫 대기 단계로 참조자를 집어 결재가 거기서 멈춘다. 화면은 이 줄을 상태가
 * 아니라 역할로 읽어 "참조" 로 그린다. 서버가 참조 단계에 어떤 상태를 줄지는 계약에 없다(가정).
 */
function referenceSteps(ids: string[], from: number): ApprovalStep[] {
  return ids
    .map(userById)
    .filter((u): u is User => !!u)
    .map((u, i) => ({
      step_no: from + i,
      approver: person(u),
      acted_by: null,
      role: 'reference' as const,
      status: 'skipped' as const,
      comment: null,
      acted_at: null,
      version: 1,
    }))
}

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

/** 저장 행. `can_decide` 는 보는 사람마다 달라서 저장하지 않고 응답에서 만든다. */
interface Stored extends Omit<ApprovalDocument, 'can_decide'> {
  drafter_id: string
}

const docs: Stored[] = []
let seq = 1
const now = () => new Date().toISOString()
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()

/**
 * 저장 행 → 응답. `drafter_id` 는 목 내부용이라 뺀다.
 *
 * `can_decide` 는 **서버가 판정해서 실어 준다.** 화면이 위임 목록을 따로 받아 스스로 재면
 * 권한 판정이 UI 로 내려온다(루트 가드레일). 위임받은 사람에게 버튼을 그리려면 이 값이 필요하다.
 */
function expose(doc: Stored, viewer?: User): ApprovalDocument {
  const copy: Partial<Stored> = { ...doc }
  delete copy.drafter_id
  return { ...(copy as ApprovalDocument), can_decide: viewer ? !!actingFor(viewer, doc) : false }
}

function summarize(doc: Stored): ApprovalListItem {
  const copy: Partial<ApprovalDocument> = expose(doc)
  delete copy.subject
  delete copy.steps
  delete copy.closed_at
  delete copy.can_decide
  return copy as ApprovalListItem
}

function currentOf(doc: Stored) {
  const step = doc.steps.find((s) => s.status === 'waiting')
  doc.current_step = doc.status === 'pending' && step ? step.step_no : null
  doc.waiting_on = doc.status === 'pending' && step ? step.approver : null
}

/** 문서를 닫는다. 아직 차례가 안 온 단계는 `skipped`(13 §6.2). "대기"로 남기면 끝난 문서가 진행 중처럼 보인다. */
function close(doc: Stored, status: 'approved' | 'rejected' | 'canceled' | 'closed', at = now()) {
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
    // 참조자는 기안 때 정해진다. 상신 전에도 문서에 남아 있어야 임시저장을 다시 열었을 때 보인다.
    steps: referenceSteps(input.references ?? [], 1),
  }
  docs.push(doc)
  return doc
}

function submit(doc: Stored, at = now()) {
  const drafter = userById(doc.drafter_id)
  // 결재선은 상신할 때 서버가 만든다(13 §4.2.2). 기안 때 고른 참조자는 그 뒤에 붙는다.
  const references = doc.steps.filter((s) => s.role === 'reference').map((s) => s.approver.id)
  const approvers = drafter ? buildSteps(drafter) : []
  // 결재자와 기안자는 참조에서 뺀다. 결재선은 상신할 때 정해져서 화면이 미리 거를 수 없다.
  // 그대로 두면 같은 사람이 결재선에 두 줄로 서고, 받은 결재함과 참조함에 같이 뜬다.
  const already = new Set([doc.drafter_id, ...approvers.map((s) => s.approver.id)])
  const kept = references.filter((id) => !already.has(id))
  doc.steps = [...approvers, ...referenceSteps(kept, approvers.length + 1)]
  doc.submitted_at = at
  // 참조가 아니라 **결재자**가 없는지를 본다. 참조자만 걸린 임원 기안을 `steps.length` 로 재면
  // 결재선이 있는 줄 알고 대기로 남는다. 아무도 처리할 수 없는 문서가 된다.
  if (approvers.length === 0) {
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
    // 위임받은 사람도 여기서 본다. 안 그러면 대신 결재할 문서에 닿을 길이 없다.
    if (box === 'inbox') return !!actingFor(user, d)
    // 상신하기 전에는 참조자에게 보이지 않는다. 기안자가 아직 고쳐 쓰는 중이다.
    return (
      d.status !== 'draft' &&
      d.steps.some((s) => s.role === 'reference' && s.approver.id === user.id)
    )
  })
  return mine
    .sort((a, b) => (b.submitted_at ?? b.created_at).localeCompare(a.submitted_at ?? a.created_at))
    .map(summarize)
}

/** 이미 처리가 끝난 단계. 회수 차단처럼 "누가 손댔는가" 를 묻는 자리는 전부 이걸 본다. */
const DECIDED = new Set<ApprovalStep['status']>(['approved', 'rejected', 'delegated_done'])

type StoredDelegation = Delegation & { owner_id: string }

const delegations: StoredDelegation[] = []

function withoutOwner(row: StoredDelegation): Delegation {
  const copy: Partial<StoredDelegation> = { ...row }
  delete copy.owner_id
  return copy as Delegation
}

let delegationSeq = 1

/**
 * 유형이 위임을 허용하는지(13 §4.1). **모든 유형 위임이라도 꺼진 유형은 넘어가지 않는다.**
 *
 * 만들 때만 막고 쓸 때 안 보면, 특정 유형은 거부하면서 "모든 유형" 을 고르면 뚫리는 우회로가
 * 된다. 지금 목에는 일반 기안 문서밖에 없어 이 줄이 실제로 걸리지는 않지만(다른 유형은
 * `createDraft` 가 422 로 막는다), 이 목이 백엔드에 넘기는 규칙 제안서다.
 */
function delegatable(typeCode: ApprovalTypeCode): boolean {
  return APPROVAL_TYPES.find((t) => t.code === typeCode)?.allow_delegate_decision ?? false
}

/**
 * 오늘이 기간 안이고 유형이 맞는 위임. 없으면 `undefined`.
 *
 * 날짜는 **로컬 기준**이다(`toISODate`). UTC 로 재면 한국에서는 자정부터 오전 아홉 시까지 하루가
 * 밀려, 오늘부터 건 위임이 아침 내내 안 먹고 끝난 위임이 다음 날 아침까지 살아 있다.
 */
function delegationFor(ownerId: string, delegateId: string, typeCode: ApprovalTypeCode) {
  if (!delegatable(typeCode)) return undefined
  const today = toISODate(new Date())
  return delegations.find(
    (d) =>
      d.owner_id === ownerId &&
      d.delegate.id === delegateId &&
      d.start_date <= today &&
      today <= d.end_date &&
      (d.type_code === null || d.type_code === typeCode),
  )
}

/**
 * 지금 이 문서를 처리할 수 있는 자리. 내 차례이거나, 지금 차례인 사람이 나에게 위임했을 때다.
 *
 * **받은 결재함·문서 열람·승인 처리가 같은 판정을 봐야 한다.** 세 곳이 따로 놀면 위임을 걸어도
 * 그 사람은 문서에 닿지 못한다(목록에 없고, 주소로 들어가면 403 이고, 버튼이 안 그려진다).
 */
function actingFor(user: User, doc: Stored) {
  if (doc.status !== 'pending') return undefined
  const step = doc.steps.find((s) => s.status === 'waiting')
  if (!step) return undefined
  if (step.approver.id === user.id) return { step, delegation: undefined }
  const delegation = delegationFor(step.approver.id, user.id, doc.type_code)
  return delegation ? { step, delegation } : undefined
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
    // 대신 결재하려면 그 문서는 볼 수 있어야 한다. 지금 차례인 그 한 건만이다.
    !!actingFor(user, doc) ||
    // 대신 눌러 준 뒤에도 남는다. 누르자마자 다음 차례로 넘어가 그 문서를 잃으면,
    // 방금 자기가 무엇을 승인했는지 확인할 길이 없다.
    doc.steps.some((s) => s.acted_by?.id === user.id) ||
    // 참조자는 **상신한 뒤에만** 볼 수 있다. 목록도 같은 기준이다. 기안 때 고른 참조자가
    // `steps` 에 먼저 들어가므로, 여기서 안 막으면 주소만 바꿔 남의 초안을 열 수 있다.
    doc.steps.some(
      (s) => s.approver.id === user.id && (s.role !== 'reference' || doc.status !== 'draft'),
    ) ||
    user.role === 'exec'
  if (!related) return fail('열람 권한이 없습니다.', 403, 'FORBIDDEN')
  return expose(doc, user)
}

/** 결재 첨부 상한. 채팅 첨부와 같다(백엔드 `MAX_ATTACHMENTS`). */
const MAX_ATTACHMENTS = 10

/** 이 문서에 올린 첨부의 경로 앞부분. 첨부 url 은 늘 이 모양이라야 한다. */
export const attachmentPrefix = (id: string) => `/api/approvals/${id}/attachments/`

/**
 * 파일 id → 올린 문서 id. 경로 모양만 보면 남의 문서 파일 id 를 내 문서 경로에 끼워 넣을 수 있다.
 * 실서버는 저장 키에 문서 id 를 넣어(`approvals/{doc_id}/{file_id}/{name}`) 같은 것을 막는다.
 */
const uploadedTo = new Map<string, string>()

export function recordAttachment(docId: string, fileId: string) {
  uploadedTo.set(fileId, docId)
}

/** 이 문서에 올린 파일의 url 인가. 경로 모양과 파일의 주인 문서를 둘 다 본다. */
function ownsAttachment(docId: string, url: string | undefined): boolean {
  const prefix = attachmentPrefix(docId)
  if (!url?.startsWith(prefix)) return false
  return uploadedTo.get(url.slice(prefix.length).split('/')[0]) === docId
}

/**
 * 생성·갱신이 같은 검증을 탄다. 어느 경로로 들어와도 서버는 같은 것을 막는다.
 *
 * 첨부 url 은 **그 문서의 업로드 경로 모양**이어야 한다. 남의 문서 첨부 url 을 끼워 넣으면
 * 내 문서를 볼 수 있는 사람이 그 파일을 받게 된다(채팅 첨부의 `VALIDATION` 과 같은 규칙).
 * 새로 만들 때는 문서 id 가 없어 올린 파일도 없다. 그래서 `docId` 가 없으면 빈 목록만 받는다.
 */
function validate(input: DraftInput, docId?: string): Failure | null {
  if (input.type_code !== 'general')
    return fail('v1 은 일반 기안만 기안할 수 있습니다.', 422, 'VALIDATION')
  if (!input.title?.trim()) return fail('제목을 입력해 주세요.', 422, 'VALIDATION')
  if (input.subject.amount !== null && !(input.subject.amount >= 0)) {
    return fail('금액이 올바르지 않습니다.', 422, 'VALIDATION')
  }
  const files = input.subject.attachments
  if (files !== undefined) {
    if (!Array.isArray(files) || files.length > MAX_ATTACHMENTS) {
      return fail(`첨부는 ${MAX_ATTACHMENTS}개까지입니다.`, 422, 'VALIDATION')
    }
    if (files.some((f) => !docId || !ownsAttachment(docId, f.url))) {
      return fail('이 문서에 올린 파일만 붙일 수 있습니다.', 422, 'VALIDATION')
    }
  }
  if (input.references !== undefined) {
    if (!Array.isArray(input.references)) {
      return fail('참조자 목록이 올바르지 않습니다.', 422, 'VALIDATION')
    }
    // 없는 사람을 조용히 버리면 프론트는 서버가 뺀 줄을 모른다. 겹친 id 도 줄을 두 개 만든다.
    if (new Set(input.references).size !== input.references.length) {
      return fail('참조자가 겹칩니다.', 422, 'VALIDATION')
    }
    if (input.references.some((id) => !userById(id))) {
      return fail('없는 사람을 참조로 걸 수 없습니다.', 422, 'VALIDATION')
    }
  }
  return null
}

export function createDraft(user: User, input: DraftInput): ApprovalDocument | Failure {
  seed()
  const invalid = validate(input)
  if (invalid) return invalid
  return expose(create(user, input), user)
}

export function updateDraft(user: User, id: string, input: DraftInput): ApprovalDocument | Failure {
  const doc = docs.find((d) => d.id === id)
  if (!doc || doc.drafter_id !== user.id) return fail('문서를 찾을 수 없습니다.', 404, 'NOT_FOUND')
  if (doc.status !== 'draft') return fail('상신한 문서는 고칠 수 없습니다.', 409, 'NOT_DRAFT')
  const invalid = validate(input, doc.id)
  if (invalid) return invalid
  doc.title = input.title.trim()
  doc.subject = input.subject
  doc.amount = input.subject.amount
  doc.related = input.subject.related
  // 안 보내면 그대로 둔다. 빈 배열은 "전부 해제" 라서 둘을 갈라야 한다.
  if (input.references !== undefined) doc.steps = referenceSteps(input.references, 1)
  return expose(doc, user)
}

/**
 * 임시저장을 지운다. 내 것, 아직 상신하지 않은 것만. 상신한 문서는 이력이라 지우지 않는다
 * (회수·반려로 끝낸 것도 남는다). 백엔드 #316 과 같다.
 */
export function deleteDraft(user: User, id: string): Failure | null {
  const index = docs.findIndex((d) => d.id === id)
  const doc = docs[index]
  if (!doc || doc.drafter_id !== user.id) return fail('문서를 찾을 수 없습니다.', 404, 'NOT_FOUND')
  if (doc.status !== 'draft') return fail('상신한 문서는 지울 수 없습니다.', 409, 'NOT_DRAFT')
  docs.splice(index, 1)
  return null
}

/** 첨부를 올릴 수 있는 문서인가. 내 임시저장만이다. 상신한 문서는 내용과 같이 첨부도 굳는다. */
export function checkAttachTarget(user: User, id: string): Failure | null {
  const doc = docs.find((d) => d.id === id)
  if (!doc || doc.drafter_id !== user.id) return fail('문서를 찾을 수 없습니다.', 404, 'NOT_FOUND')
  if (doc.status !== 'draft') return fail('상신한 문서에는 붙일 수 없습니다.', 409, 'NOT_DRAFT')
  return null
}

/**
 * 첨부를 내려받을 수 있는가. **문서 열람과 같은 판정**(`getApproval`)을 탄다(13 §8.1).
 * 그 문서에 실제로 붙어 있는 url 만 내준다. 올렸다가 뗀 파일은 404 다.
 */
export function checkAttachmentDownload(user: User, id: string, url: string): Failure | null {
  const viewed = getApproval(user, id)
  if ('error' in viewed) return viewed
  if (!viewed.subject.attachments?.some((f) => f.url === url)) {
    return fail('파일을 찾을 수 없습니다.', 404, 'NOT_FOUND')
  }
  return null
}

export function submitApproval(user: User, id: string): ApprovalDocument | Failure {
  const doc = docs.find((d) => d.id === id)
  if (!doc || doc.drafter_id !== user.id) return fail('문서를 찾을 수 없습니다.', 404, 'NOT_FOUND')
  if (doc.status !== 'draft') return fail('이미 상신한 문서입니다.', 409, 'NOT_DRAFT')
  if (!doc.subject.body.trim()) return fail('본문을 입력해 주세요.', 422, 'VALIDATION')
  submit(doc)
  return expose(doc, user)
}

/** 회수. 승인된 단계가 있으면 409(13 FR-APV-06). */
export function cancelApproval(user: User, id: string): ApprovalDocument | Failure {
  const doc = docs.find((d) => d.id === id)
  if (!doc || doc.drafter_id !== user.id) return fail('문서를 찾을 수 없습니다.', 404, 'NOT_FOUND')
  if (doc.status !== 'pending')
    return fail('대기 중인 문서만 회수할 수 있습니다.', 409, 'NOT_PENDING')
  // 대결 승인은 `delegated_done` 이라 `approved` 만 보면 빠져나간다. 남이 대신 승인해 준 결재를
  // 기안자가 조용히 거둘 수 있게 된다.
  if (doc.steps.some((s) => DECIDED.has(s.status))) {
    return fail(
      '이미 승인된 단계가 있어 회수할 수 없습니다. 반려를 요청하세요.',
      409,
      'STEP_APPROVED',
    )
  }
  close(doc, 'canceled')
  return expose(doc, user)
}

/**
 * 강제 종결(13 §9.2). 임원만, 대기 중인 문서만. 사유는 필수다.
 *
 * 사유는 그때 걸려 있던 단계에 적어 둔다. 문서에는 사유를 담을 칸이 없고(`ApprovalDocument`),
 * 결재선 이력에 남겨야 나중에 "누구 차례에서 왜 끊겼는지" 를 읽을 수 있다.
 */
export function forceClose(user: User, id: string, reason: string): ApprovalDocument | Failure {
  seed()
  const doc = docs.find((d) => d.id === id)
  if (!doc) return fail('문서를 찾을 수 없습니다.', 404, 'NOT_FOUND')
  if (user.role !== 'exec') return fail('임원만 강제 종결할 수 있습니다.', 403, 'FORBIDDEN')
  if (doc.status !== 'pending')
    return fail('대기 중인 문서만 강제 종결할 수 있습니다.', 409, 'NOT_PENDING')
  if (!reason.trim()) return fail('종결 사유를 입력해 주세요.', 400, 'REASON_REQUIRED')

  const at = now()
  const step = doc.steps.find((s) => s.status === 'waiting')
  if (step) {
    step.comment = reason.trim()
    // 원 결재자가 아닌 사람이 처리했다는 뜻이다. 화면은 이걸 "강제 종결" 로 읽는다(위임은 "대결").
    step.acted_by = person(user)
    step.acted_at = at
  }
  close(doc, 'closed', at)
  return expose(doc, user)
}

/** 내가 건 위임만 돌려준다. 남이 나에게 건 위임은 그 사람 설정이다. */
export function listDelegations(user: User): Delegation[] {
  seed()
  // 저장소에만 있는 `owner_id` 는 응답에서 뺀다. 내 목록이라 누구 것인지는 물을 필요가 없다.
  // 지금 유효한 것을 위로 올린다. 해제하지 않으면 지난 위임이 계속 쌓인다.
  const today = toISODate(new Date())
  const live = (d: StoredDelegation) => d.start_date <= today && today <= d.end_date
  return delegations
    .filter((d) => d.owner_id === user.id)
    .sort((a, b) => Number(live(b)) - Number(live(a)) || b.start_date.localeCompare(a.start_date))
    .map(withoutOwner)
}

export function createDelegation(user: User, input: DelegationInput): Delegation | Failure {
  seed()
  const delegate = userById(input.delegate_id)
  if (!delegate) return fail('없는 사람입니다.', 422, 'VALIDATION')
  if (delegate.id === user.id) return fail('자기 자신에게는 위임할 수 없습니다.', 422, 'VALIDATION')
  if (!input.start_date || !input.end_date || input.start_date > input.end_date) {
    return fail('기간이 올바르지 않습니다.', 422, 'VALIDATION')
  }
  const type = input.type_code ?? null
  if (type !== null) {
    const known = APPROVAL_TYPES.find((t) => t.code === type)
    if (!known) return fail('없는 문서 유형입니다.', 422, 'VALIDATION')
    // 유형마다 위임 가능 여부가 다르다(13 §4.1). 근태 4종 중 휴가만 켜져 있다.
    if (!known.allow_delegate_decision) {
      return fail(`${known.name} 은 위임할 수 없는 유형입니다.`, 422, 'DELEGATE_NOT_ALLOWED')
    }
  }
  // 같은 유형에 기간이 겹치면 누가 대신 결재할지가 갈린다.
  const overlap = delegations.find(
    (d) =>
      d.owner_id === user.id &&
      (d.type_code === null || type === null || d.type_code === type) &&
      d.start_date <= input.end_date &&
      input.start_date <= d.end_date,
  )
  if (overlap) return fail('기간이 겹치는 위임이 이미 있습니다.', 409, 'DELEGATION_OVERLAP')

  const made: Delegation & { owner_id: string } = {
    id: `dlg-${delegationSeq++}`,
    owner_id: user.id,
    delegate: person(delegate),
    start_date: input.start_date,
    end_date: input.end_date,
    type_code: type,
    created_at: now(),
  }
  delegations.push(made)
  return withoutOwner(made)
}

export function deleteDelegation(user: User, id: string): Failure | null {
  seed()
  const index = delegations.findIndex((d) => d.id === id && d.owner_id === user.id)
  if (index < 0) return fail('위임을 찾을 수 없습니다.', 404, 'NOT_FOUND')
  delegations.splice(index, 1)
  return null
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
  // 위임받은 사람도 처리할 수 있다(대결, 13 §4.2.3). 원 결재자 이름은 단계에 그대로 남고
  // 실제 처리자만 `acted_by` 로 붙는다.
  const acting = actingFor(user, doc)
  if (!acting) return fail('처리할 차례가 아닙니다.', 403, 'NOT_YOUR_TURN')
  const { step, delegation: delegated } = acting
  if (step.version !== version)
    return fail('문서가 그새 바뀌었습니다. 새로고침해 주세요.', 409, 'VERSION_CONFLICT')
  if (action === 'reject' && !text?.trim())
    return fail('반려 사유를 입력해 주세요.', 400, 'REASON_REQUIRED')
  const at = now()
  if (action === 'reject') {
    step.status = 'rejected'
    step.comment = text?.trim() || null
    if (delegated) step.acted_by = person(user)
    step.acted_at = at
    step.version += 1
    close(doc, 'rejected', at)
  } else {
    approveStep(step, text?.trim() || null, at)
    if (delegated) {
      step.status = 'delegated_done'
      step.acted_by = person(user)
    }
    if (doc.steps.some((s) => s.status === 'waiting')) currentOf(doc)
    else close(doc, 'approved', at)
  }
  return expose(doc, user)
}
