/**
 * CRM 주소록(15 CRM 모듈 설계서 §4·§9). 백엔드가 아직 없어 손수 맞춘 타입이다.
 * 설계서 §9 의 `/crm` 계열이 openapi 에 들어오면 `Schema<...>` 로 바꾼다.
 */

export type OrgType =
  | 'pension'
  | 'mutual_aid'
  | 'insurance'
  | 'bank'
  | 'securities'
  | 'am'
  | 'asset_owner'
  | 'advisor'
  | 'etc'

export const ORG_TYPE_LABEL: Record<OrgType, string> = {
  pension: '연기금',
  mutual_aid: '공제회',
  insurance: '보험',
  bank: '은행',
  securities: '증권',
  am: '운용사',
  asset_owner: '자산 소유자',
  advisor: '자문사',
  etc: '기타',
}

export const ORG_TYPES = Object.keys(ORG_TYPE_LABEL) as OrgType[]

export type ActivityKind = 'meeting' | 'call' | 'email' | 'memo'

export const ACTIVITY_KIND_LABEL: Record<ActivityKind, string> = {
  meeting: '미팅',
  call: '통화',
  email: '메일',
  memo: '메모',
}

export const ACTIVITY_KINDS = Object.keys(ACTIVITY_KIND_LABEL) as ActivityKind[]

/** "N일 넘게 연락 없음" 필터의 선택지(설계서 FR-CRM-31). */
export const STALE_DAYS = [30, 90, 180] as const

export const ORG_NAME_MAX = 100
export const MEMO_MAX = 2000
export const ACTIVITY_BODY_MAX = 5000

export interface Person {
  id: string
  name: string
}

export interface OrgListItem {
  id: string
  name: string
  org_type: OrgType
  /** 사내 창구. 이 기관을 맡은 우리 쪽 사람(FR-CRM-03). */
  owners: Person[]
  contact_count: number
  /** 마지막 활동 기록 시각. 기록이 없으면 null. */
  last_contacted_at: string | null
}

export interface Contact {
  id: string
  org_id: string
  /** 개인정보 삭제 처리된 담당자는 이름이 비고 `erased` 가 참이다(설계서 §4.2.5). */
  name: string
  title: string
  phone: string
  email: string
  memo: string
  erased: boolean
}

export interface OrgDetail extends OrgListItem {
  memo: string
  contacts: Contact[]
  created_at: string
}

export interface OrgInput {
  name: string
  org_type: OrgType
  memo: string
  owner_ids: string[]
}

/** 등록 응답. 이름이 비슷한 기관이 이미 있으면 막지 않고 알려만 준다(FR-CRM-01). */
export interface OrgCreated {
  org: OrgDetail
  duplicates: { id: string; name: string }[]
}

export interface ContactInput {
  org_id: string
  name: string
  title: string
  phone: string
  email: string
  memo: string
}

export interface Activity {
  id: string
  kind: ActivityKind
  occurred_at: string
  org: Person | null
  /** 외부 참석자. 삭제 처리된 담당자는 이름이 빈 문자열로 온다. */
  contacts: Person[]
  /** 사내 참석자. */
  users: Person[]
  author: Person
  body: string
  /** 고치고 지울 수 있는지. 작성자와 임원만(FR-CRM-22). 서버가 판정한다. */
  can_edit: boolean
}

export interface ActivityInput {
  kind: ActivityKind
  occurred_at: string
  org_id: string
  contact_ids: string[]
  user_ids: string[]
  body: string
}

/** 삭제된 담당자는 이름 대신 이 문구로 보인다. */
export const contactName = (contact: { name: string }) => contact.name || '삭제된 담당자'
