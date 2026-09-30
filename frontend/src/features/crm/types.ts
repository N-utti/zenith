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
  /** 이전 소속, 최근 것부터(FR-CRM-04). 옛 활동 기록은 기록 당시 기관에 그대로 있다. */
  moves: { from: Person; moved_at: string }[]
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
  /** 안건에 건 기록이면 그 안건. 기관 타임라인과 안건 타임라인 양쪽에 뜬다(15 §4.2.2). */
  deal: Person | null
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
  /** 안건은 그 기관의 안건만. 없으면 null. */
  deal_id: string | null
  contact_ids: string[]
  user_ids: string[]
  body: string
}

/** 삭제된 담당자는 이름 대신 이 문구로 보인다. */
export const contactName = (contact: { name: string }) => contact.name || '삭제된 담당자'

// ── 안건 파이프라인 (15 §2.2 · §4.2.1 · §6) ───────────────────────────

export type DealKind = 'fundraising' | 'investment' | 'disposal'

export const DEAL_KIND_LABEL: Record<DealKind, string> = {
  fundraising: '출자 유치',
  investment: '투자 안건',
  disposal: '매각',
}

export const DEAL_KINDS = Object.keys(DEAL_KIND_LABEL) as DealKind[]

/**
 * 종류별 단계(15 §4.2.1 기본안, B2 에서 두 팀 확인 대기). 서버도 같은 상수를 든다.
 * 마지막 단계에 닿으면 성사(`won`)로 끝난다.
 */
export const DEAL_STAGES: Record<DealKind, { key: string; label: string }[]> = {
  fundraising: [
    { key: 'contact', label: '접촉' },
    { key: 'proposal', label: '제안서 발송' },
    { key: 'diligence', label: '실사' },
    { key: 'committee', label: '내부 심의 대기' },
    { key: 'committed', label: '출자 확약' },
  ],
  investment: [
    { key: 'sourcing', label: '발굴' },
    { key: 'screening', label: '예비 검토' },
    { key: 'diligence', label: '실사' },
    { key: 'committee', label: '투자심의' },
    { key: 'closed', label: '투자 실행' },
  ],
  // 원매자가 여럿이어도 안건은 기관 하나에 붙는다. 나머지 원매자와의 진행은 활동 기록으로 남긴다.
  disposal: [
    { key: 'marketing', label: '원매자 접촉' },
    { key: 'prelim_bid', label: '예비입찰' },
    { key: 'diligence', label: '실사·본입찰' },
    { key: 'preferred', label: '우선협상' },
    { key: 'closed', label: '거래 종결' },
  ],
}

export const stageLabel = (kind: DealKind, stage: string) =>
  DEAL_STAGES[kind].find((s) => s.key === stage)?.label ?? stage

export type DealStatus = 'open' | 'won' | 'dropped'

export const DEAL_STATUS_LABEL: Record<DealStatus, string> = {
  open: '진행 중',
  won: '성사',
  dropped: '중단',
}

export const DEAL_NAME_MAX = 200

export interface Deal {
  id: string
  kind: DealKind
  name: string
  org: Person
  /** 사내 담당자. */
  owner: Person | null
  stage: string
  /** 원 단위. 아직 모르면 null. */
  amount_krw: number | null
  target_date: string | null
  next_action: string
  next_action_due: string | null
  status: DealStatus
  /** 낙관적 잠금(15 NFR-CRM-02). 수정할 때 그대로 돌려보내고, 어긋나면 409. */
  version: number
}

export interface DealEvent {
  id: string
  actor: Person
  from_stage: string | null
  to_stage: string
  /** 단계 이동 말고 중단·재개도 이력에 남긴다. */
  action: 'move' | 'drop' | 'reopen'
  reason: string | null
  created_at: string
}

export interface DealDetail extends Deal {
  drop_reason: string | null
  closed_at: string | null
  created_at: string
  events: DealEvent[]
}

export interface DealInput {
  kind: DealKind
  name: string
  org_id: string
  owner_id: string | null
  amount_krw: number | null
  target_date: string | null
  next_action: string
  next_action_due: string | null
}

/** 금액은 억 원으로 보인다. 인프라 안건은 수백~수천억이다. */
const eok = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 1 })
export const formatEok = (won: number) => `${eok.format(won / 1e8)}억`

// ── CSV 가져오기 (15 FR-CRM-05) ─────────────────────────────────────

/** 한 번에 올릴 수 있는 행 수. 두 팀 주소록을 옮기는 용도라 넉넉하다. */
export const IMPORT_MAX_ROWS = 2000

/**
 * 가져오기 한 행의 판정. `ok` 만 반영된다. `skip` 은 이미 있는 담당자, `error` 는 고쳐서 다시 올릴 행.
 * `line` 은 파일의 줄 번호(머리글이 1행). 엑셀에서 그 줄을 바로 찾게 한다.
 */
export interface ImportRow {
  line: number
  org_name: string
  contact_name: string
  status: 'ok' | 'skip' | 'error'
  note: string
}

export interface ImportResult {
  rows: ImportRow[]
  /** 새로 만들(만든) 기관·담당자 수. 미리보기와 반영이 같은 모양으로 온다. */
  new_orgs: number
  new_contacts: number
}
