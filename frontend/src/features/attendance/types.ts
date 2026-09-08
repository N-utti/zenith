/** 04 §10.2 휴가 계약. 항목 모양은 10 근태 설계서 §4.1 `leave_types`·`leave_requests`·`leave_balances`. */

export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'canceled'

export const LEAVE_STATUS_LABEL: Record<LeaveStatus, string> = {
  pending: '승인 대기',
  approved: '승인',
  rejected: '반려',
  canceled: '취소',
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
  | 'normal'
  | 'leave'
  | 'half_leave'
  | 'remote'
  | 'field'
  | 'trip'
  | 'holiday'
  | 'absent'

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
