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
