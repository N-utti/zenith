import {
  ACTIVITY_BODY_MAX,
  ACTIVITY_KINDS,
  MEMO_MAX,
  ORG_NAME_MAX,
  ORG_TYPE_LABEL,
  ORG_TYPES,
  type Activity,
  type ActivityInput,
  type Contact,
  type ContactInput,
  DEAL_KIND_LABEL,
  DEAL_KINDS,
  DEAL_NAME_MAX,
  DEAL_STAGES,
  DEAL_STATUS_LABEL,
  stageLabel,
  type Deal,
  type DealDetail,
  type DealEvent,
  type DealInput,
  type DealKind,
  type DeletedOrg,
  type OrgCreated,
  type OrgDetail,
  type OrgInput,
  type OrgListItem,
  type OrgType,
  type Person,
  IMPORT_MAX_ROWS,
  IMPORT_UNDO_HOURS,
  type ImportResult,
  type ImportRow,
  type ImportUndone,
  type LastImport,
} from '@/features/crm/types'
import { EMAIL_PATTERN } from '@/features/admin/types'
import { toISODate } from '@/lib/datetime'
import type { XlsxCell } from '@/lib/xlsx'
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
  /** 지울 때 적은 사유. 지운 기관 목록에서 되살릴지 판단할 때 본다. */
  deleted_reason?: string
}

/**
 * `created_by` 는 등록한 사람(시드에는 없다. 그때는 임원만 지운다). `deleted_at` 이 있으면 목록에서
 * 빠지고 활동 기록의 참석자 이름으로만 남는다.
 */
type ContactRow = Omit<Contact, 'moves' | 'can_delete'> & {
  created_by?: string
  deleted_at?: string
}

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
  ids
    .flatMap((id) => {
      const account = findAccount(id)
      return account ? [{ id: account.id, name: account.name }] : []
    })
    // 서버는 창구·참석자를 이름순으로 준다(백엔드 #311).
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'))

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
const aliveContacts = () => contacts.filter((c) => !c.deleted_at)

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
    // 개인정보를 지운 담당자는 행만 남은 것이라 세지 않는다(내보내기와 같은 기준).
    contact_count: aliveContacts().filter((c) => c.org_id === org.id && !c.erased).length,
    last_contacted_at: lastContacted(org.id),
  }
}

/** 지워진 기관으로 옮긴 적이 있어도 이력은 남긴다. 이름은 지워지기 전 것을 그대로 쓴다. */
function toContact(user: User, row: ContactRow): Contact {
  return {
    id: row.id,
    org_id: row.org_id,
    name: row.name,
    title: row.title,
    phone: row.phone,
    email: row.email,
    memo: row.memo,
    erased: row.erased,
    can_delete: canDeleteContact(user, row),
    moves: contactMoves
      .filter((m) => m.contact_id === row.id)
      .sort((a, b) => b.moved_at.localeCompare(a.moved_at))
      .map((m) => ({
        from: { id: m.from_org_id, name: orgs.find((o) => o.id === m.from_org_id)?.name ?? '' },
        moved_at: m.moved_at,
      })),
  }
}

function toDetail(user: User, org: OrgRow): OrgDetail {
  return {
    ...toListItem(org),
    memo: org.memo,
    contacts: aliveContacts()
      .filter((c) => c.org_id === org.id)
      .map((c) => toContact(user, c)),
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

export function getOrg(user: User, id: string): OrgDetail | Failure {
  const org = aliveOrg(id)
  return org ? toDetail(user, org) : notFound('기관을')
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

export function createOrg(user: User, input: OrgInput): OrgCreated | Failure {
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
  return { org: toDetail(user, row), duplicates }
}

export function updateOrg(user: User, id: string, patch: Partial<OrgInput>): OrgDetail | Failure {
  const org = aliveOrg(id)
  if (!org) return notFound('기관을')
  const bad = checkOrgInput(patch, org.owner_ids)
  if (bad) return bad
  if (patch.name !== undefined) org.name = patch.name.trim()
  if (patch.org_type !== undefined) org.org_type = patch.org_type
  if (patch.memo !== undefined) org.memo = patch.memo
  if (patch.owner_ids !== undefined) org.owner_ids = [...new Set(patch.owner_ids)]
  return toDetail(user, org)
}

/**
 * 기관 삭제는 임원만, 사유 필수(설계서 §3). 기록은 남기고 목록에서만 뺀다.
 * 진행 중 안건이 있으면 409. 삭제 한 번에 안건이 보드에서 같이 사라지지 않게 한다(이슈 #200).
 */
export function deleteOrg(user: User, id: string, reason: unknown): Failure | null {
  if (user.role !== 'exec') return forbidden()
  const org = aliveOrg(id)
  if (!org) return notFound('기관을')
  // 검증 실패는 전부 422 다(백엔드 #311. 설계서의 400 을 서버가 422 로 통일했다).
  if (typeof reason !== 'string' || !reason.trim()) return invalid('사유를 적어 주세요.')
  const open = aliveDeals().filter((d) => d.org_id === id && d.status === 'open').length
  if (open) {
    return fail(
      409,
      'CONFLICT',
      `진행 중 안건 ${open}건을 먼저 중단하거나 끝내야 지울 수 있습니다.`,
    )
  }
  org.deleted_at = new Date().toISOString()
  org.deleted_reason = reason.trim()
  return null
}

/** 지운 기관. 임원만 본다. 최근에 지운 것부터. 15 §9 에 없는 경로다(프론트가 정한 가정). */
export function listDeletedOrgs(user: User): DeletedOrg[] | Failure {
  if (user.role !== 'exec') return forbidden()
  return orgs
    .filter((o) => o.deleted_at)
    .sort((a, b) => b.deleted_at!.localeCompare(a.deleted_at!))
    .map((o) => {
      const norm = normalizeOrgName(o.name)
      const twin = orgs.find((other) => !other.deleted_at && normalizeOrgName(other.name) === norm)
      return {
        id: o.id,
        name: o.name,
        org_type: o.org_type,
        deleted_at: o.deleted_at!,
        reason: o.deleted_reason ?? '',
        duplicate: twin ? { id: twin.id, name: twin.name } : null,
      }
    })
}

/**
 * 지운 기관 되살리기. 임원만. 기관 삭제는 목록에서만 빼는 것이라, 되살리면 담당자·안건·활동
 * 기록이 그대로 돌아온다. 그사이 같은 이름의 기관이 새로 생겼어도 막지 않는다(등록과 같다, FR-CRM-01).
 */
export function restoreOrg(user: User, id: string): OrgDetail | Failure {
  if (user.role !== 'exec') return forbidden()
  const org = orgs.find((o) => o.id === id && o.deleted_at)
  if (!org) return notFound('지운 기관을')
  org.deleted_at = null
  org.deleted_reason = undefined
  return toDetail(user, org)
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

export function createContact(user: User, input: ContactInput): Contact | Failure {
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
    created_by: user.id,
  }
  contacts.push(row)
  return toContact(user, row)
}

/** `org_id` 가 바뀌면 이직이다. 이력을 남기고, 옛 활동 기록은 기록 당시 기관에 둔다(FR-CRM-04). */
export function updateContact(
  user: User,
  id: string,
  patch: Partial<ContactInput>,
): Contact | Failure {
  const contact = aliveContacts().find((c) => c.id === id)
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
  return toContact(user, contact)
}

/**
 * 개인정보 삭제(설계서 FR-CRM-06 · §4.2.5). 행은 남기고 연락처만 비운다.
 * 행을 지우면 활동 기록의 참석자가 사라져 이력이 깨진다.
 */
export function eraseContact(user: User, id: string): Contact | Failure {
  if (user.role !== 'exec') return forbidden()
  // 목록에서 지운 담당자도 된다. 지운 뒤에도 활동 기록에 이름이 남아 있어서다.
  const contact = contacts.find((c) => c.id === id)
  if (!contact) return notFound('담당자를')
  Object.assign(contact, { name: '', title: '', phone: '', email: '', memo: '', erased: true })
  return toContact(user, contact)
}

/**
 * 등록한 사람은 활동 기록에 붙기 전까지(잘못 넣은 사람을 치우는 길), 임원은 언제나 지운다.
 * 15 §9 에 없는 경로다. 프론트가 정한 가정이다.
 */
function canDeleteContact(user: User, row: ContactRow): boolean {
  if (user.role === 'exec') return true
  return (
    row.created_by === user.id && !aliveActivities().some((a) => a.contact_ids.includes(row.id))
  )
}

/**
 * 담당자 지우기. 행은 남기고 목록에서만 뺀다. 행을 지우면 활동 기록의 참석자가 사라져 이력이 깨진다.
 * 이름·연락처는 그대로 남는다. 비우는 것은 개인정보 삭제(`eraseContact`)다.
 */
export function deleteContact(user: User, id: string): Failure | null {
  const contact = aliveContacts().find((c) => c.id === id)
  if (!contact || !aliveOrg(contact.org_id)) return notFound('담당자를')
  if (!canDeleteContact(user, contact)) {
    return fail(
      403,
      'FORBIDDEN',
      '담당자는 등록한 사람(활동 기록에 붙기 전)과 임원만 지울 수 있습니다.',
    )
  }
  contact.deleted_at = new Date().toISOString()
  return null
}

/** 기기 시계가 서버보다 조금 빠른 것은 봐준다. */
const FUTURE_SLACK_MS = 5 * 60_000

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
  } else {
    // 지워진 기관의 안건은 상세가 404 다. 타임라인도 같이 막는다.
    const deal = findDeal(target.dealId)
    if (!deal || !aliveOrg(deal.org_id)) return notFound('안건을')
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
  if (input.occurred_at !== undefined) {
    const at = Date.parse(input.occurred_at)
    if (Number.isNaN(at)) return invalid('일시가 올바르지 않습니다.')
    // 미래 기록은 마지막 연락일을 앞당겨 「연락 없음」 필터를 속인다. 앞일은 다음 할 일에 적는다.
    if (at > Date.now() + FUTURE_SLACK_MS) return invalid('앞으로의 일시는 기록할 수 없습니다.')
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

/**
 * 외부 참석자는 그 기관 소속 담당자만. 다른 기관 사람을 섞으면 타임라인이 거짓말을 한다.
 * 목록에서 지운 담당자도 새로 붙일 수 없다(이미 붙어 있던 기록에는 남는다).
 */
function contactsOutside(orgId: string, ids: string[] | undefined) {
  return (ids ?? []).some((id) => aliveContacts().find((c) => c.id === id)?.org_id !== orgId)
}

export function createActivity(user: User, input: ActivityInput): Activity | Failure {
  // 기관은 늘 있어야 한다. 안건은 기관에 딸려 있어서 안건에 거는 기록도 기관을 같이 보낸다.
  if (!input.org_id || !aliveOrg(input.org_id)) return invalid('기관을 골라 주세요.')
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
  // 안건도 바뀔 때만 본다. 그사이 지운 안건에 걸려 있던 기록을 낡은 화면에서 고쳐도 막히지 않게.
  const dealChanged = patch.deal_id !== undefined && (patch.deal_id || null) !== row.deal_id
  if (dealChanged && dealOutside(row.org_id, patch.deal_id)) {
    return invalid('이 기관의 안건이 아닙니다.')
  }
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
  /** 있으면 지운 안건이다. 보드·목록·내보내기에서 빠지고 상세는 404 다. */
  deleted_at?: string
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
  {
    id: 'deal-6',
    kind: 'disposal',
    name: '메디컬센터 건물 매각',
    org_id: 'org-4',
    owner_id: 'u-6',
    stage: 'marketing',
    amount_krw: 65_000_000_000,
    target_date: daysAhead(150),
    next_action: '원매자 비밀유지계약(NDA) 회수',
    next_action_due: daysAhead(7),
    status: 'open',
    drop_reason: null,
    version: 1,
    closed_at: null,
    created_at: daysAgo(3),
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

const aliveDeals = () => deals.filter((d) => !d.deleted_at)

function findDeal(id: string) {
  return aliveDeals().find((d) => d.id === id)
}

/**
 * 등록한 사람은 활동 기록이 붙기 전까지(잘못 만든 안건을 치우는 길), 임원은 언제나 지운다.
 * 등록한 사람은 등록 이력(첫 줄)의 주인이다. 15 §9 에 없는 경로다. 프론트가 정한 가정이다.
 */
function canDeleteDeal(user: User, row: DealRow): boolean {
  if (user.role === 'exec') return true
  const creator = dealEvents.find((e) => e.deal_id === row.id && e.from_stage === null)?.actor_id
  return creator === user.id && !aliveActivities().some((a) => a.deal_id === row.id)
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

function toDealDetail(user: User, row: DealRow): DealDetail {
  return {
    ...toDeal(row),
    drop_reason: row.drop_reason,
    closed_at: row.closed_at,
    created_at: row.created_at,
    can_delete: canDeleteDeal(user, row),
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
  return aliveDeals()
    .filter((d) => !filter.kind || d.kind === filter.kind)
    .filter((d) => !filter.status || d.status === filter.status)
    .filter((d) => !filter.orgId || d.org_id === filter.orgId)
    .filter((d) => aliveOrg(d.org_id))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map(toDeal)
}

export function getDeal(user: User, id: string): DealDetail | Failure {
  const row = findDeal(id)
  return row && aliveOrg(row.org_id) ? toDealDetail(user, row) : notFound('안건을')
}

/**
 * 안건 지우기. 행과 단계 이력은 남기고 보드·목록에서만 뺀다. 붙어 있던 활동 기록은 기관의
 * 타임라인에 그대로 남는다(안건 표시만 빠진다).
 */
export function deleteDeal(user: User, id: string): Failure | null {
  const row = findDeal(id)
  if (!row || !aliveOrg(row.org_id)) return notFound('안건을')
  if (!canDeleteDeal(user, row)) {
    return fail(
      403,
      'FORBIDDEN',
      '안건은 등록한 사람(활동 기록이 붙기 전)과 임원만 지울 수 있습니다.',
    )
  }
  row.deleted_at = new Date().toISOString()
  return null
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

/** 할 일 없이 기한만 있으면 카드에 기한만 덩그러니 뜬다. 둘은 합친 값으로 본다. */
function dueWithoutAction(action: string | undefined, due: string | null | undefined) {
  return !action?.trim() && due ? invalid('다음 할 일을 적어야 기한을 둘 수 있습니다.') : null
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
    dueWithoutAction(input.next_action, input.next_action_due) ??
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
  return toDealDetail(user, row)
}

const conflict = () =>
  fail(409, 'CONFLICT', '다른 사람이 먼저 고쳤습니다. 새로 불러온 내용을 확인해 주세요.')

/**
 * 안건 수정·단계 이동(15 §6). `version` 이 어긋나면 409(NFR-CRM-02).
 * 단계는 앞뒤 어디로든 간다. 마지막 단계에 닿으면 성사로 끝나고, 임원이 거기서 옮기면 다시 진행 중이다.
 */
export function updateDeal(
  user: User,
  id: string,
  patch: Partial<Omit<DealInput, 'kind' | 'org_id'>> & { stage?: string; version?: unknown },
): DealDetail | Failure {
  const row = findDeal(id)
  if (!row || !aliveOrg(row.org_id)) return notFound('안건을')
  if (patch.version !== row.version) return conflict()
  // 할 일·기한을 건드리는 요청만 본다. 단계만 옮기는 요청이 옛 데이터 때문에 막히지 않게.
  const touchesNext = patch.next_action !== undefined || patch.next_action_due !== undefined
  const bad =
    checkDealInput(patch, row.owner_id) ??
    (touchesNext
      ? dueWithoutAction(
          patch.next_action ?? row.next_action,
          patch.next_action_due !== undefined ? patch.next_action_due : row.next_action_due,
        )
      : null)
  if (bad) return bad
  if (patch.stage !== undefined && patch.stage !== row.stage) {
    // 성사는 임원만 되돌린다(15 §6 「잘못 누른 경우는 임원이 수정한다」). 중단은 재개로 연다.
    const undoWon = row.status === 'won' && user.role === 'exec'
    if (row.status !== 'open' && !undoWon) {
      return fail(409, 'CONFLICT', '끝난 안건은 단계를 옮길 수 없습니다.')
    }
    if (!stages(row.kind).includes(patch.stage)) return invalid('단계가 올바르지 않습니다.')
    record(row, user, {
      from_stage: row.stage,
      to_stage: patch.stage,
      action: 'move',
      reason: null,
    })
    row.stage = patch.stage
    const won = patch.stage === stages(row.kind).at(-1)
    row.status = won ? 'won' : 'open'
    row.closed_at = won ? new Date().toISOString() : null
  }
  if (patch.name !== undefined) row.name = patch.name.trim()
  if (patch.owner_id !== undefined) row.owner_id = patch.owner_id || null
  if (patch.amount_krw !== undefined) row.amount_krw = patch.amount_krw
  if (patch.target_date !== undefined) row.target_date = patch.target_date || null
  if (patch.next_action !== undefined) row.next_action = patch.next_action.trim()
  if (patch.next_action_due !== undefined) row.next_action_due = patch.next_action_due || null
  row.version += 1
  return toDealDetail(user, row)
}

/** 중단. 진행 중인 안건만, 사유 필수(15 FR-CRM-12). 사유가 없으면 422(백엔드 #311). */
export function dropDeal(
  user: User,
  id: string,
  body: { reason?: unknown; version?: unknown },
): DealDetail | Failure {
  const row = findDeal(id)
  if (!row || !aliveOrg(row.org_id)) return notFound('안건을')
  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
  if (!reason) return invalid('중단 사유를 적어 주세요.')
  if (body.version !== row.version) return conflict()
  if (row.status !== 'open') return fail(409, 'CONFLICT', '진행 중인 안건만 중단할 수 있습니다.')
  row.status = 'dropped'
  row.drop_reason = reason
  row.closed_at = new Date().toISOString()
  row.version += 1
  record(row, user, { from_stage: row.stage, to_stage: row.stage, action: 'drop', reason })
  return toDealDetail(user, row)
}

/**
 * 재개. 중단된 안건만 되살린다(15 §6). 새 안건을 만들면 쌓인 활동 기록이 끊긴다.
 * 성사는 여기가 아니라 임원의 단계 이동으로 되돌린다.
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
  return toDealDetail(user, row)
}

// ── 내보내기 (15 FR-CRM-32) ───────────────────────────────────────

const day = (iso: string | null) => (iso ? toISODate(new Date(iso)) : '')
const names = (ids: string[]) =>
  people(ids)
    .map((p) => p.name)
    .join(', ')

export interface ExportTable {
  sheet: string
  /** 첫 행이 머리글이다. */
  rows: XlsxCell[][]
  integerCols?: number[]
}

/**
 * xlsx 로 나갈 표. 지운 기관과 그 기관의 담당자·안건, 개인정보를 지운 담당자는 뺀다.
 * 셀은 전부 글자·숫자로만 나간다(수식 없음, `buildXlsx`). 순서는 화면과 같게 기관 이름순·최근 안건순.
 */
export function exportRows(entity: string): ExportTable | Failure {
  const orgName = (id: string) => orgs.find((o) => o.id === id)?.name ?? ''
  const shownContacts = aliveContacts().filter((c) => !c.erased && aliveOrg(c.org_id))

  if (entity === 'orgs') {
    const rows = listOrgs({}).map((o) => {
      const row = aliveOrg(o.id)!
      return [
        o.name,
        ORG_TYPE_LABEL[o.org_type],
        o.owners.map((p) => p.name).join(', '),
        // 담당자 시트와 맞춘다. 개인정보를 지운 사람은 거기 없다.
        shownContacts.filter((c) => c.org_id === o.id).length,
        day(o.last_contacted_at),
        row.memo,
        day(row.created_at),
      ]
    })
    return {
      sheet: '기관',
      rows: [['기관', '유형', '사내 창구', '담당자 수', '마지막 연락', '메모', '등록일'], ...rows],
    }
  }

  if (entity === 'contacts') {
    const byOrg = (id: string) => normalizeOrgName(orgName(id))
    const rows = [...shownContacts]
      .sort(
        (a, b) =>
          byOrg(a.org_id).localeCompare(byOrg(b.org_id), 'ko') ||
          a.name.localeCompare(b.name, 'ko'),
      )
      .map((c) => [orgName(c.org_id), c.name, c.title, c.phone, c.email, c.memo])
    return {
      sheet: '담당자',
      rows: [['기관', '이름', '부서·직함', '전화', '이메일', '메모'], ...rows],
    }
  }

  if (entity === 'deals') {
    const header = [
      '종류',
      '안건',
      '기관',
      '단계',
      '상태',
      '금액(원)',
      '사내 담당자',
      '목표일',
      '다음 할 일',
      '기한',
      '중단 사유',
      '등록일',
    ]
    const rows = aliveDeals()
      .filter((d) => aliveOrg(d.org_id))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((d) => [
        DEAL_KIND_LABEL[d.kind],
        d.name,
        orgName(d.org_id),
        stageLabel(d.kind, d.stage),
        DEAL_STATUS_LABEL[d.status],
        d.amount_krw ?? '',
        d.owner_id ? names([d.owner_id]) : '',
        d.target_date ?? '',
        d.next_action,
        d.next_action_due ?? '',
        d.drop_reason ?? '',
        day(d.created_at),
      ])
    return { sheet: '안건', rows: [header, ...rows], integerCols: [header.indexOf('금액(원)')] }
  }

  return invalid('entity 는 orgs·contacts·deals 중 하나여야 합니다.')
}

const IMPORT_HEADERS = {
  org: '기관',
  type: '유형',
  name: '이름',
  title: '부서·직함',
  phone: '전화',
  email: '이메일',
  memo: '메모',
} as const

const TYPE_BY_LABEL = new Map(ORG_TYPES.map((t) => [ORG_TYPE_LABEL[t], t]))

/**
 * CSV 가져오기(15 FR-CRM-05). 한 행이 담당자 한 명이고, 이름 칸이 비면 기관만 만든다.
 * 이름이 빈 행의 메모는 새 기관의 메모가 된다(기관 내보내기 파일도 올릴 수 있다).
 * 칸 이름은 담당자 내보내기와 같다(기관·이름·부서·직함·전화·이메일·메모) + 선택 칸 유형.
 * 내보낸 파일을 고쳐서 그대로 다시 올릴 수 있다.
 *
 * 기관은 정규화한 이름(FR-CRM-01)으로 기존 기관에 붙인다. 가져오기로 중복 기관을 만들지 않는다.
 * 같은 기관에 같은 이름의 담당자가 있으면 건너뛴다. 실패 행은 사유와 함께 돌려주고 나머지는 반영한다.
 * `dryRun` 이면 판정만 하고 아무것도 만들지 않는다.
 */
export function importContacts(
  user: User,
  rows: string[][],
  dryRun: boolean,
): ImportResult | Failure {
  const [header = [], ...rest] = rows
  // 줄 번호는 빈 행을 걸러내기 전에 매긴다. 엑셀의 행 번호와 같게(머리글이 1행).
  const body = rest
    .map((cells, i) => ({ cells, line: i + 2 }))
    .filter(({ cells }) => cells.some((c) => c.trim()))
  const col = (label: string) => header.findIndex((h) => h.trim() === label)
  const idx = Object.fromEntries(
    Object.entries(IMPORT_HEADERS).map(([key, label]) => [key, col(label)]),
  ) as Record<keyof typeof IMPORT_HEADERS, number>
  if (idx.org < 0) return invalid('첫 줄에 「기관」 칸이 있어야 합니다.')
  if (body.length === 0) return invalid('가져올 행이 없습니다.')
  if (body.length > IMPORT_MAX_ROWS) {
    return invalid(`한 번에 ${IMPORT_MAX_ROWS}행까지 올릴 수 있습니다.`)
  }

  // 정규화 이름 → 기존 기관 id, 또는 이 파일에서 새로 만들 기관(아직 id 없음).
  const known = new Map<string, { id: string | null; name: string }>()
  for (const o of orgs) if (!o.deleted_at) known.set(normalizeOrgName(o.name), o)
  // 이미 있는 담당자와 이 파일에서 앞서 받은 담당자(기관 정규화 이름 + 담당자 이름).
  const seen = new Set(
    aliveContacts()
      .filter((c) => !c.erased && aliveOrg(c.org_id))
      .map((c) => `${normalizeOrgName(aliveOrg(c.org_id)!.name)}\n${c.name}`),
  )

  const result: ImportResult = { rows: [], new_orgs: 0, new_contacts: 0 }
  // 이 가져오기로 만든 것. 되돌릴 때 이것만 지운다.
  const made = { org_ids: [] as string[], contact_ids: [] as string[] }
  body.forEach(({ cells, line }) => {
    const get = (key: keyof typeof IMPORT_HEADERS) =>
      (idx[key] < 0 ? '' : (cells[idx[key]] ?? '')).trim()
    const orgName = get('org')
    const name = get('name')
    const row: ImportRow = {
      line,
      org_name: orgName,
      contact_name: name,
      status: 'ok',
      note: '',
    }
    result.rows.push(row)
    const reject = (note: string) => Object.assign(row, { status: 'error', note })

    const typeLabel = get('type')
    const orgType = typeLabel ? TYPE_BY_LABEL.get(typeLabel) : 'etc'
    if (!orgType) return reject(`유형 「${typeLabel}」 을 알 수 없습니다.`)
    // 기관만 있는 행의 메모는 새 기관의 메모가 된다. 여기서 같이 본다. 안 보면 반영이 중간에 던져
    // 앞 행들은 만들어지고 되돌릴 기록은 안 남는다.
    const orgBad = checkOrgInput({
      name: orgName,
      org_type: orgType,
      memo: name ? '' : get('memo'),
    })
    if (orgBad) return reject(orgBad.error)
    const contact = {
      name,
      title: get('title'),
      phone: get('phone'),
      email: get('email'),
      memo: get('memo'),
    }
    if (name) {
      const bad = checkContactInput(contact)
      if (bad) return reject(bad.error)
    } else if (contact.title || contact.phone || contact.email) {
      return reject('담당자 이름이 비었습니다.')
    }

    const norm = normalizeOrgName(orgName)
    let org = known.get(norm)
    const notes: string[] = []
    // 기관만 있는 행(기관 내보내기 파일)의 메모는 새 기관의 메모로 쓴다.
    if (!name && org) {
      row.status = 'skip'
      row.note = '이미 있는 기관'
      return
    }
    if (!org) {
      org = {
        id: dryRun
          ? null
          : ok(
              createOrg(user, {
                name: orgName,
                org_type: orgType,
                memo: name ? '' : contact.memo,
                owner_ids: [],
              }),
            ).org.id,
        name: orgName,
      }
      if (org.id) made.org_ids.push(org.id)
      known.set(norm, org)
      result.new_orgs++
      notes.push('새 기관')
    } else if (org.name !== orgName) {
      notes.push(`기존 기관 「${org.name}」 에 붙임`)
    }

    if (name) {
      const key = `${norm}\n${name}`
      if (seen.has(key)) {
        row.status = 'skip'
        row.note = '이미 있는 담당자'
        return
      }
      seen.add(key)
      if (!dryRun) {
        made.contact_ids.push(ok(createContact(user, { org_id: org.id!, ...contact })).id)
      }
      result.new_contacts++
    }
    row.note = notes.join(' · ')
  })
  if (made.org_ids.length + made.contact_ids.length > 0) {
    imports.push({
      id: nextId('imp'),
      user_id: user.id,
      created_at: new Date().toISOString(),
      ...made,
    })
  }
  return result
}

// ── 가져오기 되돌리기 ──────────────────────────────────────────────
// 15 §9 에 없는 경로다. 프론트가 정한 가정이다.

/** 반영된 가져오기와 그때 만든 것. 되돌리면 빠진다. */
const imports: {
  id: string
  user_id: string
  created_at: string
  org_ids: string[]
  contact_ids: string[]
}[] = []

const undoable = (batch: { created_at: string }) =>
  Date.now() - new Date(batch.created_at).getTime() < IMPORT_UNDO_HOURS * 3_600_000

/** 내가 한 마지막 가져오기. 없거나 되돌릴 기한이 지났으면 `null`. */
export function lastImport(user: User): LastImport | null {
  const batch = imports.filter((b) => b.user_id === user.id).at(-1)
  return batch && undoable(batch)
    ? {
        id: batch.id,
        created_at: batch.created_at,
        new_orgs: batch.org_ids.length,
        new_contacts: batch.contact_ids.length,
      }
    : null
}

/**
 * 가져오기 되돌리기. 가져온 사람만, 기한 안에. 그 가져오기로 만든 담당자와 기관을 행째 지운다(잘못
 * 올린 파일의 수백 줄을 지운 기관 목록에 쌓지 않는다).
 *
 * 그사이 쓰이기 시작한 것은 남긴다.
 * - 가져온 기관에 안건·활동 기록·이직 이력이 생겼거나 누가 담당자를 더 넣었으면 동료가 쓰기 시작한
 *   기관이다. 기관과 거기 가져온 담당자를 통째로 남긴다. 연락처만 지우면 다시 입력해야 한다.
 * - 그 밖의 담당자(기존 기관에 붙인 사람 포함)는 활동 기록에 붙었거나 이직했거나 개인정보를 지운
 *   사람만 남긴다.
 * 목록에서 지운 행도 같은 판정을 거친다. 안 쓰였으면 같이 치운다. 건너뛰면 담당자 없는 빈 기관이
 * 남는다. 지운 안건과 지운 활동 기록은 쓰인 것으로 치지 않는다(되살릴 길이 없는 기록이다).
 * ponytail: 가져온 뒤 손으로 고친 칸(전화번호, 메모)은 알 수 없어 같이 지워진다. 그래서 기한을 둔다.
 */
export function undoImport(user: User, id: string): ImportUndone | Failure {
  const index = imports.findIndex((b) => b.id === id)
  const batch = imports[index]
  if (!batch) return notFound('가져오기를')
  if (batch.user_id !== user.id) return forbidden()
  if (!undoable(batch)) {
    return fail(409, 'CONFLICT', `가져온 지 ${IMPORT_UNDO_HOURS}시간이 지나 되돌릴 수 없습니다.`)
  }

  const mine = new Set(batch.contact_ids)
  const records = aliveActivities()
  const moved = (contactId: string) => contactMoves.some((m) => m.contact_id === contactId)
  // 동료가 쓰기 시작한 기관.
  const busy = new Set(
    batch.org_ids.filter(
      (orgId) =>
        aliveDeals().some((d) => d.org_id === orgId) ||
        records.some((a) => a.org_id === orgId) ||
        contactMoves.some((m) => m.from_org_id === orgId || m.to_org_id === orgId) ||
        contacts.some((c) => c.org_id === orgId && !mine.has(c.id) && !c.deleted_at),
    ),
  )

  // 목록에서 이미 지운 행은 수에 넣지 않는다. 화면에 없던 것이다.
  const done: ImportUndone = {
    removed_orgs: 0,
    removed_contacts: 0,
    kept_orgs: 0,
    kept_contacts: 0,
  }
  for (const contactId of batch.contact_ids) {
    const at = contacts.findIndex((c) => c.id === contactId)
    const row = contacts[at]
    if (!row) continue
    const used =
      busy.has(row.org_id) ||
      row.erased ||
      moved(contactId) ||
      records.some((a) => a.contact_ids.includes(contactId))
    if (!used) contacts.splice(at, 1)
    if (!row.deleted_at) done[used ? 'kept_contacts' : 'removed_contacts']++
  }
  for (const orgId of batch.org_ids) {
    const at = orgs.findIndex((o) => o.id === orgId)
    const row = orgs[at]
    if (!row) continue
    // 위에서 남긴 담당자가 있으면 기관도 남긴다.
    const used = busy.has(orgId) || contacts.some((c) => c.org_id === orgId)
    if (!used) orgs.splice(at, 1)
    if (!row.deleted_at) done[used ? 'kept_orgs' : 'removed_orgs']++
  }
  imports.splice(index, 1)
  return done
}

/** 앞에서 검증을 끝낸 뒤에 부른다. 여기서 실패하면 목의 버그다. */
function ok<R extends object>(result: R | Failure): R {
  if ('error' in result) throw new Error(result.error)
  return result
}
