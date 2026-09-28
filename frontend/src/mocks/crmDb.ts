import {
  ACTIVITY_BODY_MAX,
  ACTIVITY_KINDS,
  MEMO_MAX,
  ORG_NAME_MAX,
  ORG_TYPES,
  type Activity,
  type ActivityInput,
  type Contact,
  type ContactInput,
  DEAL_KINDS,
  DEAL_NAME_MAX,
  DEAL_STAGES,
  type Deal,
  type DealDetail,
  type DealEvent,
  type DealInput,
  type DealKind,
  type OrgCreated,
  type OrgDetail,
  type OrgInput,
  type OrgListItem,
  type OrgType,
  type Person,
} from '@/features/crm/types'
import { EMAIL_PATTERN } from '@/features/admin/types'
import { toISODate } from '@/lib/datetime'
import type { User } from '@/types'
import { findAccount } from './adminDb'

/** 실패는 결재 목과 같은 모양이다. 핸들러가 그대로 응답으로 바꾼다. */
type Failure = { error: string; status: number; code: string }

const fail = (status: number, code: string, error: string): Failure => ({ error, status, code })
/** `what` 은 조사까지 붙여 넘긴다(기관을·담당자를). */
const notFound = (what: string) => fail(404, 'NOT_FOUND', `${what} 찾을 수 없습니다.`)
const forbidden = () => fail(403, 'FORBIDDEN', '권한이 부족합니다.')
const invalid = (error: string) => fail(422, 'VALIDATION', error)

interface OrgRow {
  id: string
  name: string
  org_type: OrgType
  memo: string
  owner_ids: string[]
  created_at: string
  deleted_at: string | null
}

type ContactRow = Omit<Contact, 'moves'>

/** 담당자 이직 이력(설계서 §4.1 `crm_contact_moves`). */
interface MoveRow {
  contact_id: string
  from_org_id: string
  to_org_id: string
  moved_at: string
}

interface ActivityRow {
  id: string
  kind: Activity['kind']
  occurred_at: string
  org_id: string
  deal_id: string | null
  contact_ids: string[]
  user_ids: string[]
  author_id: string
  body: string
  deleted_at: string | null
}

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString()

// 이름은 지어낸 기관이다. 실제 기관명을 목에 넣지 않는다.
// 창구는 인프라 유치팀(장지윤 u-4)과 펀드팀(안재호 u-5 · 김다인 u-6).
const orgs: OrgRow[] = [
  {
    id: 'org-1',
    name: '한결연금공단',
    org_type: 'pension',
    memo: '대체투자실. 인프라 블라인드 펀드 선호.',
    owner_ids: ['u-4'],
    created_at: daysAgo(200),
    deleted_at: null,
  },
  {
    id: 'org-2',
    name: '누리공제회',
    org_type: 'mutual_aid',
    memo: '',
    owner_ids: ['u-5', 'u-4'],
    created_at: daysAgo(180),
    deleted_at: null,
  },
  {
    id: 'org-3',
    name: '다온생명보험',
    org_type: 'insurance',
    memo: '신재생 인프라는 내부 한도 소진. 내년 재접촉.',
    owner_ids: ['u-6'],
    created_at: daysAgo(150),
    deleted_at: null,
  },
  {
    id: 'org-4',
    name: '(주)미래인프라자산운용',
    org_type: 'am',
    memo: '공동투자 상대.',
    owner_ids: ['u-5'],
    created_at: daysAgo(120),
    deleted_at: null,
  },
  {
    id: 'org-5',
    name: '세움은행',
    org_type: 'bank',
    memo: '',
    owner_ids: [],
    created_at: daysAgo(40),
    deleted_at: null,
  },
]

const contacts: ContactRow[] = [
  {
    id: 'con-1',
    org_id: 'org-1',
    name: '박서준',
    title: '대체투자실 팀장',
    phone: '02-0000-1001',
    email: 'sj.park@hangyeol.example',
    memo: '',
    erased: false,
  },
  {
    id: 'con-2',
    org_id: 'org-1',
    name: '이하은',
    title: '대체투자실 과장',
    phone: '',
    email: 'he.lee@hangyeol.example',
    memo: '실무 담당. 자료 요청은 이쪽으로.',
    erased: false,
  },
  {
    id: 'con-3',
    org_id: 'org-2',
    name: '최민호',
    title: '투자본부장',
    phone: '02-0000-2001',
    email: '',
    memo: '',
    erased: false,
  },
  {
    id: 'con-4',
    org_id: 'org-3',
    name: '정유나',
    title: '인프라투자팀 차장',
    phone: '',
    email: 'yn.jung@daon.example',
    memo: '',
    erased: false,
  },
  {
    id: 'con-5',
    org_id: 'org-4',
    name: '한도윤',
    title: '인프라본부 상무',
    phone: '02-0000-4001',
    email: 'dy.han@mirae-infra.example',
    memo: '',
    erased: false,
  },
]

// 한도윤은 다온생명보험에서 옮겨 왔다. 이직 이력이 어떻게 보이는지 보여 주는 자리.
const contactMoves: MoveRow[] = [
  { contact_id: 'con-5', from_org_id: 'org-3', to_org_id: 'org-4', moved_at: daysAgo(60) },
]

const activities: ActivityRow[] = [
  {
    id: 'act-1',
    kind: 'meeting',
    occurred_at: daysAgo(3),
    org_id: 'org-1',
    deal_id: 'deal-1',
    contact_ids: ['con-1', 'con-2'],
    user_ids: ['u-4', 'u-11'],
    author_id: 'u-4',
    body: '2호 펀드 제안서 설명. 실사 질의서를 다음 주 중 보내 주기로 함.',
    deleted_at: null,
  },
  {
    id: 'act-2',
    kind: 'call',
    occurred_at: daysAgo(20),
    org_id: 'org-1',
    deal_id: null,
    contact_ids: ['con-2'],
    user_ids: ['u-4'],
    author_id: 'u-4',
    body: '미팅 일정 조율.',
    deleted_at: null,
  },
  {
    id: 'act-3',
    kind: 'email',
    occurred_at: daysAgo(45),
    org_id: 'org-2',
    deal_id: null,
    contact_ids: ['con-3'],
    user_ids: ['u-5'],
    author_id: 'u-5',
    body: '연간 출자 계획 문의. 11월 투자위원회 이후 회신 예정.',
    deleted_at: null,
  },
  {
    id: 'act-4',
    kind: 'meeting',
    occurred_at: daysAgo(130),
    org_id: 'org-3',
    deal_id: null,
    contact_ids: ['con-4'],
    user_ids: ['u-6'],
    author_id: 'u-6',
    body: '신재생 한도 소진으로 올해는 어렵다고 함.',
    deleted_at: null,
  },
]

let seq = 100
const nextId = (prefix: string) => `${prefix}-${++seq}`

/**
 * 사람은 계정 저장소 한 곳에서 찾는다. 고르기 명단(`/api/people`)이 거기서 오므로, 관리자 화면에서
 * 새로 만든 계정도 창구·참석자로 고르고 이름으로 보여야 한다.
 */
const people = (ids: string[]): Person[] =>
  ids.flatMap((id) => {
    const account = findAccount(id)
    return account ? [{ id: account.id, name: account.name }] : []
  })

/**
 * 중복 판정용 이름. 공백·대소문자·법인 표기((주)·㈜·주식회사)를 지운다(FR-CRM-01).
 * "(주)한국투자" 와 "한국투자 주식회사" 가 같은 값이 된다.
 */
export function normalizeOrgName(name: string): string {
  return name
    .replace(/\(주\)|㈜|주식회사/g, '')
    .replace(/\s+/g, '')
    .toLowerCase()
}

const aliveOrg = (id: string) => orgs.find((o) => o.id === id && !o.deleted_at)
const aliveActivities = () => activities.filter((a) => !a.deleted_at)

/** 활동 기록에서 바로 뽑는다. 실서버는 `crm_orgs.last_contacted_at` 에 들고 있다(설계서 §4.2.3). */
function lastContacted(orgId: string): string | null {
  let latest: string | null = null
  for (const a of aliveActivities()) {
    if (a.org_id === orgId && (!latest || a.occurred_at > latest)) latest = a.occurred_at
  }
  return latest
}

function toListItem(org: OrgRow): OrgListItem {
  return {
    id: org.id,
    name: org.name,
    org_type: org.org_type,
    owners: people(org.owner_ids),
    contact_count: contacts.filter((c) => c.org_id === org.id).length,
    last_contacted_at: lastContacted(org.id),
  }
}

/** 지워진 기관으로 옮긴 적이 있어도 이력은 남긴다. 이름은 지워지기 전 것을 그대로 쓴다. */
function toContact(row: ContactRow): Contact {
  return {
    ...row,
    moves: contactMoves
      .filter((m) => m.contact_id === row.id)
      .sort((a, b) => b.moved_at.localeCompare(a.moved_at))
      .map((m) => ({
        from: { id: m.from_org_id, name: orgs.find((o) => o.id === m.from_org_id)?.name ?? '' },
        moved_at: m.moved_at,
      })),
  }
}

function toDetail(org: OrgRow): OrgDetail {
  return {
    ...toListItem(org),
    memo: org.memo,
    contacts: contacts.filter((c) => c.org_id === org.id).map(toContact),
    created_at: org.created_at,
  }
}

export function listOrgs(filter: {
  q?: string
  type?: string
  owner?: string
  staleDays?: number
}): OrgListItem[] {
  const q = filter.q ? normalizeOrgName(filter.q) : ''
  const cutoff = filter.staleDays ? daysAgo(filter.staleDays) : null
  return orgs
    .filter((o) => !o.deleted_at)
    .filter((o) => !q || normalizeOrgName(o.name).includes(q))
    .filter((o) => !filter.type || o.org_type === filter.type)
    .filter((o) => !filter.owner || o.owner_ids.includes(filter.owner))
    .map(toListItem)
    .filter((o) => !cutoff || !o.last_contacted_at || o.last_contacted_at < cutoff)
    .sort((a, b) => normalizeOrgName(a.name).localeCompare(normalizeOrgName(b.name), 'ko'))
}

export function getOrg(id: string): OrgDetail | Failure {
  const org = aliveOrg(id)
  return org ? toDetail(org) : notFound('기관을')
}

/** `current` 는 지금 앉아 있는 창구. 그 사람이 퇴사했다고 다른 칸 수정까지 막지 않는다. */
function checkOrgInput(input: Partial<OrgInput>, current: string[] = []): Failure | null {
  if (input.name !== undefined) {
    const name = typeof input.name === 'string' ? input.name.trim() : ''
    if (!name || name.length > ORG_NAME_MAX) {
      return invalid(`기관 이름은 1자 이상 ${ORG_NAME_MAX}자 이하여야 합니다.`)
    }
  }
  if (input.org_type !== undefined && !ORG_TYPES.includes(input.org_type)) {
    return invalid('기관 유형이 올바르지 않습니다.')
  }
  if (
    input.memo !== undefined &&
    (typeof input.memo !== 'string' || input.memo.length > MEMO_MAX)
  ) {
    return invalid(`메모는 ${MEMO_MAX}자를 넘을 수 없습니다.`)
  }
  if (input.owner_ids !== undefined) {
    if (!Array.isArray(input.owner_ids)) return invalid('사내 창구가 올바르지 않습니다.')
    // 비활성 계정을 창구로 **새로** 앉히지만 못하게 한다. 폼은 창구 목록을 통째로 보내므로,
    // 이미 앉아 있던 퇴사자까지 막으면 그 사람을 빼기 전에는 메모 한 줄도 못 고친다.
    const added = input.owner_ids.filter((id) => !current.includes(id))
    if (added.some((id) => !findAccount(id)?.active)) {
      return invalid('사내 창구는 재직 중인 사람만 지정할 수 있습니다.')
    }
  }
  return null
}

export function createOrg(input: OrgInput): OrgCreated | Failure {
  const bad =
    checkOrgInput(input) ??
    (input.name === undefined || input.org_type === undefined
      ? invalid('기관 이름과 유형은 필수입니다.')
      : null)
  if (bad) return bad

  const name = input.name.trim()
  const norm = normalizeOrgName(name)
  const duplicates = orgs
    .filter((o) => !o.deleted_at && normalizeOrgName(o.name) === norm)
    .map((o) => ({ id: o.id, name: o.name }))

  const row: OrgRow = {
    id: nextId('org'),
    name,
    org_type: input.org_type,
    memo: input.memo ?? '',
    owner_ids: [...new Set(input.owner_ids ?? [])],
    created_at: new Date().toISOString(),
    deleted_at: null,
  }
  orgs.push(row)
  return { org: toDetail(row), duplicates }
}

export function updateOrg(id: string, patch: Partial<OrgInput>): OrgDetail | Failure {
  const org = aliveOrg(id)
  if (!org) return notFound('기관을')
  const bad = checkOrgInput(patch, org.owner_ids)
  if (bad) return bad
  if (patch.name !== undefined) org.name = patch.name.trim()
  if (patch.org_type !== undefined) org.org_type = patch.org_type
  if (patch.memo !== undefined) org.memo = patch.memo
  if (patch.owner_ids !== undefined) org.owner_ids = [...new Set(patch.owner_ids)]
  return toDetail(org)
}

/** 기관 삭제는 임원만, 사유 필수(설계서 §3). 기록은 남기고 목록에서만 뺀다. */
export function deleteOrg(user: User, id: string, reason: unknown): Failure | null {
  if (user.role !== 'exec') return forbidden()
  const org = aliveOrg(id)
  if (!org) return notFound('기관을')
  if (typeof reason !== 'string' || !reason.trim())
    return fail(400, 'VALIDATION', '사유를 적어 주세요.')
  org.deleted_at = new Date().toISOString()
  return null
}

function checkContactInput(input: Partial<ContactInput>): Failure | null {
  if (input.name !== undefined && (typeof input.name !== 'string' || !input.name.trim())) {
    return invalid('담당자 이름을 입력해 주세요.')
  }
  if (input.email && !EMAIL_PATTERN.test(input.email)) return invalid('이메일 형식이 아닙니다.')
  if (input.memo !== undefined && input.memo.length > MEMO_MAX) {
    return invalid(`메모는 ${MEMO_MAX}자를 넘을 수 없습니다.`)
  }
  return null
}

export function createContact(input: ContactInput): Contact | Failure {
  if (!aliveOrg(input.org_id)) return invalid('기관을 먼저 골라 주세요.')
  const bad =
    checkContactInput(input) ?? (input.name ? null : invalid('담당자 이름을 입력해 주세요.'))
  if (bad) return bad
  const row: ContactRow = {
    id: nextId('con'),
    org_id: input.org_id,
    name: input.name.trim(),
    title: input.title?.trim() ?? '',
    phone: input.phone?.trim() ?? '',
    email: input.email?.trim() ?? '',
    memo: input.memo ?? '',
    erased: false,
  }
  contacts.push(row)
  return toContact(row)
}

/** `org_id` 가 바뀌면 이직이다. 이력을 남기고, 옛 활동 기록은 기록 당시 기관에 둔다(FR-CRM-04). */
export function updateContact(id: string, patch: Partial<ContactInput>): Contact | Failure {
  const contact = contacts.find((c) => c.id === id)
  if (!contact) return notFound('담당자를')
  if (contact.erased) return fail(409, 'CONFLICT', '개인정보가 삭제된 담당자는 고칠 수 없습니다.')
  const bad = checkContactInput(patch)
  if (bad) return bad
  const moving = patch.org_id !== undefined && patch.org_id !== contact.org_id
  if (moving && !aliveOrg(patch.org_id!)) return invalid('옮겨 갈 기관을 찾을 수 없습니다.')
  for (const key of ['name', 'title', 'phone', 'email'] as const) {
    if (patch[key] !== undefined) contact[key] = patch[key].trim()
  }
  if (patch.memo !== undefined) contact.memo = patch.memo
  if (moving) {
    contactMoves.push({
      contact_id: contact.id,
      from_org_id: contact.org_id,
      to_org_id: patch.org_id!,
      moved_at: new Date().toISOString(),
    })
    contact.org_id = patch.org_id!
  }
  return toContact(contact)
}

/**
 * 개인정보 삭제(설계서 FR-CRM-06 · §4.2.5). 행은 남기고 연락처만 비운다.
 * 행을 지우면 활동 기록의 참석자가 사라져 이력이 깨진다.
 */
export function eraseContact(user: User, id: string): Contact | Failure {
  if (user.role !== 'exec') return forbidden()
  const contact = contacts.find((c) => c.id === id)
  if (!contact) return notFound('담당자를')
  Object.assign(contact, { name: '', title: '', phone: '', email: '', memo: '', erased: true })
  return toContact(contact)
}

const canEditActivity = (user: User, row: ActivityRow) =>
  row.author_id === user.id || user.role === 'exec'

function toActivity(user: User, row: ActivityRow): Activity {
  const org = orgs.find((o) => o.id === row.org_id)
  const deal = row.deal_id ? findDeal(row.deal_id) : undefined
  return {
    id: row.id,
    kind: row.kind,
    occurred_at: row.occurred_at,
    org: org ? { id: org.id, name: org.name } : null,
    deal: deal ? { id: deal.id, name: deal.name } : null,
    contacts: row.contact_ids
      .map((id) => contacts.find((c) => c.id === id))
      .filter((c): c is ContactRow => !!c)
      .map((c) => ({ id: c.id, name: c.name })),
    users: people(row.user_ids),
    author: people([row.author_id])[0] ?? { id: row.author_id, name: '' },
    body: row.body,
    can_edit: canEditActivity(user, row),
  }
}

/** 기관 또는 안건의 타임라인. 안건에 건 기록은 그 기관 타임라인에도 뜬다(15 §4.2.2). */
export function listActivities(
  user: User,
  target: { orgId: string } | { dealId: string },
): Activity[] | Failure {
  if ('orgId' in target) {
    if (!aliveOrg(target.orgId)) return notFound('기관을')
  } else if (!findDeal(target.dealId)) {
    return notFound('안건을')
  }
  return aliveActivities()
    .filter((a) => ('orgId' in target ? a.org_id === target.orgId : a.deal_id === target.dealId))
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
    .map((a) => toActivity(user, a))
}

function checkActivityInput(input: Partial<ActivityInput>): Failure | null {
  if (input.kind !== undefined && !ACTIVITY_KINDS.includes(input.kind)) {
    return invalid('활동 유형이 올바르지 않습니다.')
  }
  if (input.occurred_at !== undefined && Number.isNaN(Date.parse(input.occurred_at))) {
    return invalid('일시가 올바르지 않습니다.')
  }
  if (input.body !== undefined) {
    const body = typeof input.body === 'string' ? input.body.trim() : ''
    if (!body || body.length > ACTIVITY_BODY_MAX) {
      return invalid(`내용은 1자 이상 ${ACTIVITY_BODY_MAX}자 이하여야 합니다.`)
    }
  }
  if (input.user_ids !== undefined && input.user_ids.some((id) => !findAccount(id))) {
    return invalid('사내 참석자가 올바르지 않습니다.')
  }
  return null
}

/** 안건도 그 기관의 안건만. 다른 기관 안건에 걸면 두 타임라인이 서로 다른 말을 한다. */
function dealOutside(orgId: string, dealId: string | null | undefined) {
  return !!dealId && findDeal(dealId)?.org_id !== orgId
}

/** 외부 참석자는 그 기관 소속 담당자만. 다른 기관 사람을 섞으면 타임라인이 거짓말을 한다. */
function contactsOutside(orgId: string, ids: string[] | undefined) {
  return (ids ?? []).some((id) => contacts.find((c) => c.id === id)?.org_id !== orgId)
}

export function createActivity(user: User, input: ActivityInput): Activity | Failure {
  // 기관은 늘 있어야 한다. 안건은 기관에 딸려 있어서 안건에 거는 기록도 기관을 같이 보낸다.
  if (!input.org_id || !aliveOrg(input.org_id))
    return fail(400, 'VALIDATION', '기관을 골라 주세요.')
  const bad =
    checkActivityInput(input) ??
    (input.kind && input.occurred_at && input.body ? null : invalid('유형·일시·내용은 필수입니다.'))
  if (bad) return bad
  if (contactsOutside(input.org_id, input.contact_ids)) {
    return invalid('외부 참석자는 이 기관의 담당자여야 합니다.')
  }
  if (dealOutside(input.org_id, input.deal_id)) return invalid('이 기관의 안건이 아닙니다.')
  const row: ActivityRow = {
    id: nextId('act'),
    kind: input.kind,
    occurred_at: new Date(input.occurred_at).toISOString(),
    org_id: input.org_id,
    deal_id: input.deal_id || null,
    contact_ids: [...new Set(input.contact_ids ?? [])],
    user_ids: [...new Set(input.user_ids ?? [])],
    author_id: user.id,
    body: input.body.trim(),
    deleted_at: null,
  }
  activities.push(row)
  return toActivity(user, row)
}

export function updateActivity(
  user: User,
  id: string,
  patch: Partial<Omit<ActivityInput, 'org_id'>>,
): Activity | Failure {
  const row = activities.find((a) => a.id === id && !a.deleted_at)
  if (!row) return notFound('활동 기록을')
  if (!canEditActivity(user, row)) return forbidden()
  const bad = checkActivityInput(patch)
  if (bad) return bad
  // 그사이 이직한 참석자는 이미 기록에 있던 사람이라 그대로 둘 수 있다. 새로 넣는 사람만 본다.
  const added = patch.contact_ids?.filter((cid) => !row.contact_ids.includes(cid))
  if (contactsOutside(row.org_id, added)) {
    return invalid('외부 참석자는 이 기관의 담당자여야 합니다.')
  }
  if (dealOutside(row.org_id, patch.deal_id)) return invalid('이 기관의 안건이 아닙니다.')
  if (patch.deal_id !== undefined) row.deal_id = patch.deal_id || null
  if (patch.kind !== undefined) row.kind = patch.kind
  if (patch.occurred_at !== undefined) row.occurred_at = new Date(patch.occurred_at).toISOString()
  if (patch.body !== undefined) row.body = patch.body.trim()
  if (patch.contact_ids !== undefined) row.contact_ids = [...new Set(patch.contact_ids)]
  if (patch.user_ids !== undefined) row.user_ids = [...new Set(patch.user_ids)]
  return toActivity(user, row)
}

/** 작성자 또는 임원만. 지워도 행은 남긴다(설계서 FR-CRM-22, soft delete). */
export function deleteActivity(user: User, id: string): Failure | null {
  const row = activities.find((a) => a.id === id && !a.deleted_at)
  if (!row) return notFound('활동 기록을')
  if (!canEditActivity(user, row)) return forbidden()
  row.deleted_at = new Date().toISOString()
  return null
}

// ── 안건 파이프라인 (15 §2.2 · §4.2.1 · §6) ────────────────────────────

interface DealRow {
  id: string
  kind: DealKind
  name: string
  org_id: string
  owner_id: string | null
  stage: string
  amount_krw: number | null
  target_date: string | null
  next_action: string
  next_action_due: string | null
  status: Deal['status']
  drop_reason: string | null
  version: number
  closed_at: string | null
  created_at: string
}

interface DealEventRow {
  id: string
  deal_id: string
  actor_id: string
  from_stage: string | null
  to_stage: string
  action: DealEvent['action']
  reason: string | null
  created_at: string
}

/** 오늘부터 며칠 뒤의 현지 날짜. `toISOString` 을 자르면 한국 새벽에 하루 밀린다. */
const daysAhead = (days: number) => toISODate(new Date(Date.now() + days * 86_400_000))

const deals: DealRow[] = [
  {
    id: 'deal-1',
    kind: 'fundraising',
    name: '인프라 2호 펀드 출자',
    org_id: 'org-1',
    owner_id: 'u-4',
    stage: 'diligence',
    amount_krw: 50_000_000_000,
    target_date: daysAhead(60),
    next_action: '실사 질의서 답변 송부',
    next_action_due: daysAhead(4),
    status: 'open',
    drop_reason: null,
    version: 1,
    closed_at: null,
    created_at: daysAgo(40),
  },
  {
    id: 'deal-2',
    kind: 'fundraising',
    name: '인프라 2호 펀드 출자',
    org_id: 'org-2',
    owner_id: 'u-5',
    stage: 'proposal',
    amount_krw: 30_000_000_000,
    target_date: null,
    next_action: '11월 투자위원회 결과 확인',
    // 기한이 지난 할 일. 보드 카드에 "기한 지남" 으로 보인다.
    next_action_due: daysAhead(-2),
    status: 'open',
    drop_reason: null,
    version: 1,
    closed_at: null,
    created_at: daysAgo(50),
  },
  {
    id: 'deal-3',
    kind: 'fundraising',
    name: '신재생 블라인드 펀드 출자',
    org_id: 'org-3',
    owner_id: 'u-6',
    stage: 'contact',
    amount_krw: null,
    target_date: null,
    next_action: '',
    next_action_due: null,
    status: 'dropped',
    drop_reason: '올해 신재생 한도 소진. 내년 재접촉.',
    version: 2,
    closed_at: daysAgo(120),
    created_at: daysAgo(150),
  },
  {
    id: 'deal-4',
    kind: 'investment',
    name: '서해안 해상풍력 지분 인수',
    org_id: 'org-4',
    owner_id: 'u-5',
    stage: 'screening',
    amount_krw: 120_000_000_000,
    target_date: daysAhead(120),
    next_action: '공동투자 조건 협의',
    next_action_due: daysAhead(10),
    status: 'open',
    drop_reason: null,
    version: 1,
    closed_at: null,
    created_at: daysAgo(20),
  },
  {
    id: 'deal-5',
    kind: 'investment',
    name: '도심 데이터센터 개발',
    org_id: 'org-4',
    owner_id: 'u-4',
    stage: 'sourcing',
    amount_krw: 80_000_000_000,
    target_date: null,
    next_action: '',
    next_action_due: null,
    status: 'open',
    drop_reason: null,
    version: 1,
    closed_at: null,
    created_at: daysAgo(5),
  },
]

/** 시드 안건마다 등록 이력 한 줄. 중간 이동은 생략하고 지금 단계에서 등록된 것으로 둔다. */
const dealEvents: DealEventRow[] = deals.map((d) => ({
  id: `dev-${d.id}`,
  deal_id: d.id,
  actor_id: d.owner_id ?? 'u-4',
  from_stage: null,
  to_stage: d.stage,
  action: 'move',
  reason: null,
  created_at: d.created_at,
}))

function findDeal(id: string) {
  return deals.find((d) => d.id === id)
}
const stages = (kind: DealKind) => DEAL_STAGES[kind].map((s) => s.key)
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

function toDeal(row: DealRow): Deal {
  const org = orgs.find((o) => o.id === row.org_id)
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    org: { id: row.org_id, name: org?.name ?? '' },
    owner: row.owner_id ? (people([row.owner_id])[0] ?? null) : null,
    stage: row.stage,
    amount_krw: row.amount_krw,
    target_date: row.target_date,
    next_action: row.next_action,
    next_action_due: row.next_action_due,
    status: row.status,
    version: row.version,
  }
}

function toDealDetail(row: DealRow): DealDetail {
  return {
    ...toDeal(row),
    drop_reason: row.drop_reason,
    closed_at: row.closed_at,
    created_at: row.created_at,
    // 최신이 위. 같은 시각(연달아 누른 경우)이면 나중에 쌓인 쪽이 위다. 정렬은 안정적이라
    // 뒤집어 놓고 정렬하면 동률끼리는 뒤집힌 순서를 지킨다.
    events: dealEvents
      .filter((e) => e.deal_id === row.id)
      .reverse()
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((e) => ({
        id: e.id,
        actor: people([e.actor_id])[0] ?? { id: e.actor_id, name: '' },
        from_stage: e.from_stage,
        to_stage: e.to_stage,
        action: e.action,
        reason: e.reason,
        created_at: e.created_at,
      })),
  }
}

export function listDeals(filter: { kind?: string; status?: string; orgId?: string }): Deal[] {
  return deals
    .filter((d) => !filter.kind || d.kind === filter.kind)
    .filter((d) => !filter.status || d.status === filter.status)
    .filter((d) => !filter.orgId || d.org_id === filter.orgId)
    .filter((d) => aliveOrg(d.org_id))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map(toDeal)
}

export function getDeal(id: string): DealDetail | Failure {
  const row = findDeal(id)
  return row && aliveOrg(row.org_id) ? toDealDetail(row) : notFound('안건을')
}

function checkDealInput(input: Partial<DealInput>, currentOwner: string | null): Failure | null {
  if (input.name !== undefined) {
    const name = typeof input.name === 'string' ? input.name.trim() : ''
    if (!name || name.length > DEAL_NAME_MAX) {
      return invalid(`안건 이름은 1자 이상 ${DEAL_NAME_MAX}자 이하여야 합니다.`)
    }
  }
  if (input.org_id !== undefined && !aliveOrg(input.org_id)) return invalid('기관을 골라 주세요.')
  // 퇴사한 기존 담당자는 그대로 둘 수 있다. 새로 앉히는 사람만 재직 여부를 본다(기관 창구와 같다).
  if (input.owner_id && input.owner_id !== currentOwner && !findAccount(input.owner_id)?.active) {
    return invalid('담당자는 재직 중인 사람만 지정할 수 있습니다.')
  }
  if (
    input.amount_krw !== undefined &&
    input.amount_krw !== null &&
    !(Number.isSafeInteger(input.amount_krw) && input.amount_krw >= 0)
  ) {
    return invalid('금액은 0 이상의 원 단위 정수여야 합니다.')
  }
  for (const key of ['target_date', 'next_action_due'] as const) {
    const value = input[key]
    if (value !== undefined && value !== null && !ISO_DAY.test(value)) {
      return invalid('날짜 형식이 올바르지 않습니다.')
    }
  }
  return null
}

function record(
  row: DealRow,
  user: User,
  event: Pick<DealEventRow, 'from_stage' | 'to_stage' | 'action' | 'reason'>,
) {
  dealEvents.push({
    id: nextId('dev'),
    deal_id: row.id,
    actor_id: user.id,
    created_at: new Date().toISOString(),
    ...event,
  })
}

export function createDeal(user: User, input: DealInput): DealDetail | Failure {
  if (!DEAL_KINDS.includes(input.kind)) return invalid('안건 종류가 올바르지 않습니다.')
  const bad =
    checkDealInput(input, null) ??
    (input.name && input.org_id ? null : invalid('안건 이름과 기관은 필수입니다.'))
  if (bad) return bad
  const first = stages(input.kind)[0]!
  const row: DealRow = {
    id: nextId('deal'),
    kind: input.kind,
    name: input.name.trim(),
    org_id: input.org_id,
    owner_id: input.owner_id || null,
    stage: first,
    amount_krw: input.amount_krw ?? null,
    target_date: input.target_date || null,
    next_action: input.next_action?.trim() ?? '',
    next_action_due: input.next_action_due || null,
    status: 'open',
    drop_reason: null,
    version: 1,
    closed_at: null,
    created_at: new Date().toISOString(),
  }
  deals.push(row)
  record(row, user, { from_stage: null, to_stage: first, action: 'move', reason: null })
  return toDealDetail(row)
}

const conflict = () =>
  fail(409, 'CONFLICT', '다른 사람이 먼저 고쳤습니다. 새로 불러온 내용을 확인해 주세요.')

/**
 * 안건 수정·단계 이동(15 §6). `version` 이 어긋나면 409(NFR-CRM-02).
 * 단계는 앞뒤 어디로든 간다. 마지막 단계에 닿으면 성사로 끝난다.
 */
export function updateDeal(
  user: User,
  id: string,
  patch: Partial<Omit<DealInput, 'kind' | 'org_id'>> & { stage?: string; version?: unknown },
): DealDetail | Failure {
  const row = findDeal(id)
  if (!row || !aliveOrg(row.org_id)) return notFound('안건을')
  if (patch.version !== row.version) return conflict()
  const bad = checkDealInput(patch, row.owner_id)
  if (bad) return bad
  if (patch.stage !== undefined && patch.stage !== row.stage) {
    if (row.status !== 'open') return fail(409, 'CONFLICT', '끝난 안건은 단계를 옮길 수 없습니다.')
    if (!stages(row.kind).includes(patch.stage)) return invalid('단계가 올바르지 않습니다.')
    record(row, user, {
      from_stage: row.stage,
      to_stage: patch.stage,
      action: 'move',
      reason: null,
    })
    row.stage = patch.stage
    if (patch.stage === stages(row.kind).at(-1)) {
      row.status = 'won'
      row.closed_at = new Date().toISOString()
    }
  }
  if (patch.name !== undefined) row.name = patch.name.trim()
  if (patch.owner_id !== undefined) row.owner_id = patch.owner_id || null
  if (patch.amount_krw !== undefined) row.amount_krw = patch.amount_krw
  if (patch.target_date !== undefined) row.target_date = patch.target_date || null
  if (patch.next_action !== undefined) row.next_action = patch.next_action.trim()
  if (patch.next_action_due !== undefined) row.next_action_due = patch.next_action_due || null
  row.version += 1
  return toDealDetail(row)
}

/** 중단. 진행 중인 안건만, 사유 필수(15 FR-CRM-12, TC-CRM-04 는 400). */
export function dropDeal(
  user: User,
  id: string,
  body: { reason?: unknown; version?: unknown },
): DealDetail | Failure {
  const row = findDeal(id)
  if (!row || !aliveOrg(row.org_id)) return notFound('안건을')
  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
  if (!reason) return fail(400, 'VALIDATION', '중단 사유를 적어 주세요.')
  if (body.version !== row.version) return conflict()
  if (row.status !== 'open') return fail(409, 'CONFLICT', '진행 중인 안건만 중단할 수 있습니다.')
  row.status = 'dropped'
  row.drop_reason = reason
  row.closed_at = new Date().toISOString()
  row.version += 1
  record(row, user, { from_stage: row.stage, to_stage: row.stage, action: 'drop', reason })
  return toDealDetail(row)
}

/**
 * 재개. 중단된 안건만 되살린다(15 §6). 새 안건을 만들면 쌓인 활동 기록이 끊긴다.
 * 성사는 되돌리지 않는다.
 */
export function reopenDeal(
  user: User,
  id: string,
  body: { version?: unknown },
): DealDetail | Failure {
  const row = findDeal(id)
  if (!row || !aliveOrg(row.org_id)) return notFound('안건을')
  if (body.version !== row.version) return conflict()
  if (row.status !== 'dropped') return fail(409, 'CONFLICT', '중단된 안건만 재개할 수 있습니다.')
  row.status = 'open'
  row.drop_reason = null
  row.closed_at = null
  row.version += 1
  record(row, user, { from_stage: row.stage, to_stage: row.stage, action: 'reopen', reason: null })
  return toDealDetail(row)
}
