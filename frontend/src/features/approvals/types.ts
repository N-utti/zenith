/**
 * 전자결재 계약(13 §4 · §9). 엔진은 "누가 언제 어떤 순서로"만 들고, 무엇을 결재하는지는
 * `subject` 가 든다(13 §1.2). v1 최소판은 일반 기안(`general`)만 기안하고, 근태 4종은
 * 근태 화면의 신청이 그대로 결재 문서가 된다(13 §7.3).
 */

export type ApprovalTypeCode = 'leave' | 'arrangement' | 'overtime' | 'correction' | 'general'

export const APPROVAL_TYPE_LABEL: Record<ApprovalTypeCode, string> = {
  leave: '휴가',
  arrangement: '예외 근무',
  overtime: '연장근로',
  correction: '근태 정정',
  general: '일반 기안',
}

export interface ApprovalType {
  code: ApprovalTypeCode
  name: string
  /** 기본 결재 단계 수 */
  default_steps: number
  allow_delegate_decision: boolean
}

/**
 * 13 §6.1 문서 상태. 종료 상태에서 되돌아오는 경로는 없다.
 *
 * `closed` 는 임원이 강제로 끝낸 문서다(13 §9.2 `force-close`). **이 값은 프론트 가정이다.**
 * 백엔드가 아직 결재 모듈 전체를 501 로 두고 있어 종결 상태 이름이 계약에 없다. 서버가 다른
 * 이름을 쓰면 여기만 고치면 되고, 그동안 모르는 값이 와도 `statusLabel` 이 코드를 그대로 그린다.
 */
export type DocumentStatus = 'draft' | 'pending' | 'approved' | 'rejected' | 'canceled' | 'closed'

const DOCUMENT_STATUS_LABEL: Record<DocumentStatus, string> = {
  draft: '임시저장',
  pending: '결재 대기',
  approved: '승인',
  rejected: '반려',
  canceled: '회수',
  closed: '강제 종결',
}

/** 13 §10 상태 색상. 강제 종결(`closed`)의 색은 계약에 없어 경고색으로 뒀다(프론트 가정). */
export type StatusTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger'

const DOCUMENT_STATUS_TONE: Record<DocumentStatus, StatusTone> = {
  draft: 'neutral',
  pending: 'accent',
  approved: 'success',
  rejected: 'danger',
  canceled: 'neutral',
  closed: 'warning',
}

/**
 * 모르는 상태가 와도 배지를 비우지 않는다. 결재 모듈은 백엔드가 아직 안 만들어서 상태 이름이
 * 바뀔 수 있는데, 그때 화면에서 배지가 빈칸이 되면 무슨 일이 일어난 문서인지 알 수 없게 된다.
 */
export function statusLabel(status: DocumentStatus): string {
  return DOCUMENT_STATUS_LABEL[status] ?? `알 수 없음(${status})`
}

export function statusTone(status: DocumentStatus): StatusTone {
  // 모르는 상태는 눈에 걸려야 한다. 회색으로 두면 임시저장·회수와 섞여 아무도 못 알아챈다.
  return DOCUMENT_STATUS_TONE[status] ?? 'warning'
}

/** 13 §6.2 단계 상태 */
export type StepStatus = 'waiting' | 'approved' | 'rejected' | 'delegated_done' | 'skipped'

export interface Person {
  id: string
  name: string
}

export interface ApprovalStep {
  step_no: number
  approver: Person
  /**
   * 그 단계를 실제로 처리한 사람. 원 결재자가 처리했으면 `null` 이다.
   *
   * 위임 결재(대결, 13 §4.2.3)와 임원의 강제 종결이 여기 들어간다. 강제 종결은 백엔드가
   * 결재 모듈을 안 만들어서 프론트 가정이다(PR 본문).
   */
  acted_by: Person | null
  role: 'approve' | 'reference'
  status: StepStatus
  comment: string | null
  acted_at: string | null
  /** 낙관적 잠금(13 §4.2.5). 승인·반려 요청에 되돌려 보낸다 */
  version: number
}

/**
 * 일반 기안 본문(13 §4.1 `approval_forms`). 출장비 결의서처럼 근태 문서에 딸린 기안은
 * `related` 로 원 문서를 가리킨다. 13 에는 없는 프론트 가정(PR 본문): 13 §6.1 의 "원문 참조
 * 링크"와 같은 자리를 쓰자는 제안이다.
 */
export interface GeneralSubject {
  body: string
  /** 지출 금액(원). 전결 판정용, 없으면 null */
  amount: number | null
  related: { type: 'arrangement'; id: string } | null
}

export interface ApprovalListItem {
  id: string
  type_code: ApprovalTypeCode
  drafter: Person
  title: string
  status: DocumentStatus
  /** 진행 중 단계 순번. 대기 중이 아니면 null */
  current_step: number | null
  /** 지금 처리해야 할 사람. 결재함에서 "누가 막고 있나"를 한 줄로 보인다(13 §5.3) */
  waiting_on: Person | null
  submitted_at: string | null
  created_at: string
  amount: number | null
  related: GeneralSubject['related']
}

export interface ApprovalDocument extends ApprovalListItem {
  subject: GeneralSubject
  steps: ApprovalStep[]
  closed_at: string | null
  /**
   * 지금 이 사람이 승인·반려를 누를 수 있는가. **서버가 판정해서 준다.**
   *
   * 내 차례일 때와, 지금 차례인 사람이 나에게 위임했을 때(대결)가 여기 다 들어간다. 화면이
   * 위임 목록을 따로 받아 스스로 재면 권한 판정이 UI 로 내려온다. 계약에 없어서 정한 칸이다.
   */
  can_decide: boolean
}

export type ApprovalBox = 'inbox' | 'sent' | 'reference' | 'draft'

export const BOX_LABEL: Record<ApprovalBox, string> = {
  inbox: '받은 결재',
  sent: '보낸 결재',
  reference: '참조',
  draft: '임시저장',
}

export interface DraftInput {
  type_code: 'general'
  title: string
  subject: GeneralSubject
  /**
   * 참조자(13 FR-APV-16). 결재는 안 하지만 문서를 볼 사람들의 id 다.
   *
   * **계약에 없어서 정한 모양이다.** 백엔드 스텁 요약은 `{type_code, title, subject, steps?}`
   * 인데, `steps` 는 결재선 전체를 덮어쓰는 자리로 읽힌다. 결재선은 서버가 만들고(13 §5.2)
   * 기안자는 참조자만 더하므로, 그 둘을 한 칸에 섞지 않았다.
   *
   * 고칠 때(`PATCH`)는 **생략과 빈 배열의 뜻이 다르다.** 안 보내면 그대로 두고, `[]` 는 전부
   * 해제다. 제목·본문과 달리 이 칸만 부분 갱신인 셈이라 서버도 같이 갈라야 한다.
   */
  references?: string[]
}

/**
 * 결재 위임(13 §4.2.3). 내가 자리를 비우는 동안 이 사람이 대신 결재한다.
 *
 * **계약에 없어서 정한 모양이다.** 백엔드는 결재 모듈 전체가 501 이고 위임은 경로 셋에
 * 한 줄 요약(`위임 목록`·`위임 설정`·`위임 해제`)뿐이다. 서버가 붙을 때 여기를 맞춘다.
 */
export interface Delegation {
  id: string
  /** 대신 결재할 사람. */
  delegate: Person
  /** 위임 기간. `YYYY-MM-DD`, 양끝을 포함한다. */
  start_date: string
  end_date: string
  /** 이 유형만 위임하면 그 코드, 모든 유형이면 `null`. */
  type_code: ApprovalTypeCode | null
  created_at: string
}

export interface DelegationInput {
  delegate_id: string
  start_date: string
  end_date: string
  /** 안 보내면 모든 유형이다. */
  type_code?: ApprovalTypeCode | null
}
