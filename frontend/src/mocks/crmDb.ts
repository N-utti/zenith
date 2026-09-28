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
  type OrgCreated,
  type OrgDetail,
  type OrgInput,
  type OrgListItem,
  type OrgType,
  type Person,
} from '@/features/crm/types'
import { EMAIL_PATTERN } from '@/features/admin/types'
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

interface ActivityRow {
  id: string
  kind: Activity['kind']
  occurred_at: string
  org_id: string
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

const contacts: Contact[] = [
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

const activities: ActivityRow[] = [
  {
    id: 'act-1',
    kind: 'meeting',
    occurred_at: daysAgo(3),
    org_id: 'org-1',
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

function toDetail(org: OrgRow): OrgDetail {
  return {
    ...toListItem(org),
    memo: org.memo,
    contacts: contacts.filter((c) => c.org_id === org.id),
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
  const row: Contact = {
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
  return row
}

/** 소속 기관 변경(이직)은 이 PR 범위 밖이라 `org_id` 는 받지 않는다. */
export function updateContact(
  id: string,
  patch: Partial<Omit<ContactInput, 'org_id'>>,
): Contact | Failure {
  const contact = contacts.find((c) => c.id === id)
  if (!contact) return notFound('담당자를')
  if (contact.erased) return fail(409, 'CONFLICT', '개인정보가 삭제된 담당자는 고칠 수 없습니다.')
  const bad = checkContactInput(patch)
  if (bad) return bad
  for (const key of ['name', 'title', 'phone', 'email'] as const) {
    if (patch[key] !== undefined) contact[key] = patch[key].trim()
  }
  if (patch.memo !== undefined) contact.memo = patch.memo
  return contact
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
  return contact
}

const canEditActivity = (user: User, row: ActivityRow) =>
  row.author_id === user.id || user.role === 'exec'

function toActivity(user: User, row: ActivityRow): Activity {
  const org = orgs.find((o) => o.id === row.org_id)
  return {
    id: row.id,
    kind: row.kind,
    occurred_at: row.occurred_at,
    org: org ? { id: org.id, name: org.name } : null,
    contacts: row.contact_ids
      .map((id) => contacts.find((c) => c.id === id))
      .filter((c): c is Contact => !!c)
      .map((c) => ({ id: c.id, name: c.name })),
    users: people(row.user_ids),
    author: people([row.author_id])[0] ?? { id: row.author_id, name: '' },
    body: row.body,
    can_edit: canEditActivity(user, row),
  }
}

export function listActivities(user: User, orgId: string): Activity[] | Failure {
  if (!aliveOrg(orgId)) return notFound('기관을')
  return aliveActivities()
    .filter((a) => a.org_id === orgId)
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

/** 외부 참석자는 그 기관 소속 담당자만. 다른 기관 사람을 섞으면 타임라인이 거짓말을 한다. */
function contactsOutside(orgId: string, ids: string[] | undefined) {
  return (ids ?? []).some((id) => contacts.find((c) => c.id === id)?.org_id !== orgId)
}

export function createActivity(user: User, input: ActivityInput): Activity | Failure {
  // 기관·안건 중 하나는 있어야 한다(FR-CRM-20). 안건은 아직 없어 기관이 필수다.
  if (!input.org_id || !aliveOrg(input.org_id))
    return fail(400, 'VALIDATION', '기관을 골라 주세요.')
  const bad =
    checkActivityInput(input) ??
    (input.kind && input.occurred_at && input.body ? null : invalid('유형·일시·내용은 필수입니다.'))
  if (bad) return bad
  if (contactsOutside(input.org_id, input.contact_ids)) {
    return invalid('외부 참석자는 이 기관의 담당자여야 합니다.')
  }
  const row: ActivityRow = {
    id: nextId('act'),
    kind: input.kind,
    occurred_at: new Date(input.occurred_at).toISOString(),
    org_id: input.org_id,
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
  if (contactsOutside(row.org_id, patch.contact_ids)) {
    return invalid('외부 참석자는 이 기관의 담당자여야 합니다.')
  }
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
