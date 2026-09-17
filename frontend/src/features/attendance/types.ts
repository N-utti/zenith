/** 04 §10.2 휴가 계약. 항목 모양은 10 근태 설계서 §4.1 `leave_types`·`leave_requests`·`leave_balances`. */
import type { Role, Team } from '@/types'

export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'canceled'

export const LEAVE_STATUS_LABEL: Record<LeaveStatus, string> = {
  pending: '승인 대기',
  approved: '승인',
  rejected: '반려',
  canceled: '취소',
}

/** 신청 상태 배지 색. 휴가·예외 근무 목록이 같이 쓴다. */
export const REQUEST_STATUS_TONE: Record<LeaveStatus, 'neutral' | 'accent' | 'success' | 'danger'> =
  {
    pending: 'accent',
    approved: 'success',
    rejected: 'danger',
    canceled: 'neutral',
  }

export interface LeaveType {
  /** annual | half_am | half_pm | sick | family | unpaid | official */
  code: string
  name: string
  paid: boolean
  /** 연차 차감 일수. 0 | 0.5 | 1 */
  deduct_days: number
  /** half 는 하루짜리(반차). 기간을 고를 수 없다. */
  unit: 'day' | 'half'
}

export interface LeaveRequest {
  id: string
  type_code: string
  start_date: string
  end_date: string
  /** 서버가 산출한 차감 일수 */
  days: number
  reason: string
  status: LeaveStatus
  created_at: string
  decided_at: string | null
}

/**
 * 전사 캘린더(홈)에 오르는 휴가. "누가 언제 어떤 휴가" 넷뿐이다.
 * 사유·신청 시각은 본인과 결재선의 것이라 전 직원에게 보내지 않고, 승인된 것만 온다(대기분은 서버가 거른다).
 * 04 §10.2 에 없는 응답(PR 본문).
 */
export interface LeaveOnCalendar {
  id: string
  user: { id: string; name: string }
  type_code: string
  start_date: string
  end_date: string
}

export interface LeaveBalance {
  year: number
  granted: number
  used: number
  remaining: number
  expires_on: string
  grant_basis: 'hire_date' | 'fiscal_year'
}

/**
 * 전사 연차 현황 한 행(연차 관리 탭, 임원). 잔여 계산은 `LeaveBalance` 와 같고 누구 것인지만 붙는다.
 * 04 §10.2 의 `/leaves/balance` 는 본인 것만이라 `GET /leaves/balances` 는 프론트 확장(PR 본문). 임원 외 403.
 */
export interface LeaveBalanceRow extends LeaveBalance {
  user: { id: string; name: string; role: Role; team: Team | null }
}

export interface LeaveRequestInput {
  type_code: string
  start_date: string
  end_date: string
  /** 연차·반차는 사유가 없다(근기법 §60, 청구한 시기에 준다). 차감 없는 휴가(병가·경조사·공가)만 필수. */
  reason?: string
}

// ── 내 근태 (04 §10.1 · 10 §9.1) ──────────────────────────────

/** 10 §5.2 상태 판정 결과. 출퇴근 시각이 없으므로 지각·조퇴는 없다. */
export type AttendanceStatus =
  'normal' | 'leave' | 'half_leave' | 'remote' | 'field' | 'trip' | 'holiday' | 'absent'

export const ATTENDANCE_STATUS_LABEL: Record<AttendanceStatus, string> = {
  normal: '정상',
  leave: '휴가',
  half_leave: '반차',
  remote: '재택',
  field: '외근',
  trip: '출장',
  holiday: '휴일',
  absent: '결근',
}

/**
 * `att_days` 한 행(10 §4.1). 근무일에만 행이 있다(§4.2.2). 주말·공휴일은 행이 없고,
 * 휴일근로가 승인된 날만 `day_kind` 가 `workday` 가 아닌 행이 생긴다.
 */
export interface AttendanceDay {
  work_date: string
  day_kind: 'workday' | 'weekly_holiday' | 'public_holiday' | 'company_holiday'
  status: AttendanceStatus
  /** 소정근로 환산일. 1 | 0.5 | 0 */
  worked_days: number
  /** 승인된 연장근로(분). 자기신고분만 담긴다(10 §1.4). */
  overtime_minutes: number
  /** 연장 중 22시~06시 구간(분) */
  night_minutes: number
  note: string | null
}

/** `GET /attendance/me?month=` 응답. 집계 키는 10 §9.1 그대로. */
export interface AttendanceMonth {
  month: string
  days: AttendanceDay[]
  summary: {
    worked_days: number
    leave_days: number
    overtime_minutes: number
    night_minutes: number
  }
}

/**
 * `GET /attendance/me/summary?from=&to=` 응답. 기간 집계다(04 §10.1).
 *
 * **응답 모양은 계약에 없다**(경로만 스텁으로 있다). 달 조회와 같은 집계 키를 쓰고 날짜 범위를
 * 되돌려 준다고 가정했다. 일자 배열은 싣지 않는다. 기간이 길면 그게 응답의 대부분이 되는데
 * 화면은 합계만 그린다.
 */
export interface AttendanceRange {
  from: string
  to: string
  summary: AttendanceMonth['summary']
}

/**
 * 전사 근태 그리드 한 행(임원). 사람마다 `GET /attendance/me` 와 같은 달력·집계에 누구인지가 붙는다.
 * 04 §10.5 `GET /attendance/team?month=&team_id=` 를 `team_id` 없이 부르면 전사(exec 전용)로 가정한 프론트 확장(PR 본문).
 * 이 회사에는 팀장이 없어(조직도) 팀 단위 조회는 쓰지 않는다.
 */
export interface AttendanceGridRow {
  user: { id: string; name: string; role: Role; team: Team | null }
  days: AttendanceDay[]
  summary: AttendanceMonth['summary']
}

export interface AttendanceGrid {
  month: string
  items: AttendanceGridRow[]
}

// ── 예외 근무 (04 §10.3 · 10 §9.3) ─────────────────────────────

/** 신청 상태는 휴가와 같다(10 §4.1 세 신청 테이블 모두 pending|approved|rejected|canceled). */
export type RequestStatus = LeaveStatus

export type ArrangementKind = 'remote' | 'field' | 'trip'

/** 재택·외근·출장 사전 등록(10 §4.1 `work_arrangements`). */
export interface Arrangement {
  id: string
  kind: ArrangementKind
  start_date: string
  end_date: string
  reason: string
  status: RequestStatus
  created_at: string
  decided_at: string | null
}

export interface ArrangementInput {
  kind: ArrangementKind
  start_date: string
  end_date: string
  reason: string
}

/**
 * 전사 캘린더(홈)에 오르는 예외 근무. 휴가와 같이 "누가 언제 무엇" 뿐이고 사유는 없다(10 §8).
 * 04 §10.3 의 scope 는 `me|team` 뿐이라 `all` 은 프론트 확장(PR 본문).
 */
export interface ArrangementOnCalendar {
  id: string
  user: { id: string; name: string }
  kind: ArrangementKind
  start_date: string
  end_date: string
}

/** 연장근로 신청(10 §4.1 `overtime_requests`). `minutes`·`night_minutes` 는 서버 산출(10 §5.3). */
export interface Overtime {
  id: string
  work_date: string
  /** `18:00` */
  start_time: string
  /** 시작보다 이르면 자정을 넘긴 것 */
  end_time: string
  minutes: number
  night_minutes: number
  reason: string
  status: RequestStatus
  created_at: string
  decided_at: string | null
}

export interface OvertimeInput {
  work_date: string
  start_time: string
  end_time: string
  reason: string
}

/** 근태 정정 신청(10 §4.1 `att_corrections`). `after` 가 바꾸려는 값, 승인 전 값은 서버가 `before` 로 보존. */
export interface Correction {
  id: string
  work_date: string
  after: { status?: AttendanceStatus; note?: string }
  reason: string
  status: RequestStatus
  created_at: string
  decided_at: string | null
}

export interface CorrectionInput {
  work_date: string
  after: { status?: AttendanceStatus; note?: string }
  reason: string
}

// ── 월 마감 (10 §5.5 · §9.5) ────────────────────────────────

/**
 * 한 달의 마감 상태와 마감·해제 이력(최신순). 10 §9.5 는 `POST /attendance/close`·`/reopen` 만 두고
 * 조회 경로가 없어 `GET /attendance/closings/{month}` 는 프론트 확장(PR 본문). 조회는 전원, 마감·해제는 임원.
 * `status` 가 `closed` 면 `closed_at`·`closed_by` 는 항상 있다(서버 계약으로 적을 것).
 */
export interface MonthClosing {
  month: string
  status: 'open' | 'closed'
  closed_at: string | null
  closed_by: { id: string; name: string } | null
  history: {
    action: 'close' | 'reopen'
    at: string
    by: { id: string; name: string }
    /** 해제에만. 감사 로그에도 남는다. */
    reason?: string
  }[]
}

// ── 공휴일·회사 휴일 (10 §6 · §9.6) ──────────────────────────

export type HolidayKind = 'public' | 'company'

export const HOLIDAY_KIND_LABEL: Record<HolidayKind, string> = {
  public: '공휴일',
  company: '회사 휴일',
}

/** `holidays` 한 행(10 §4.1). 날짜가 키다. */
export interface Holiday {
  date: string
  name: string
  kind: HolidayKind
}

export type HolidayInput = Holiday
