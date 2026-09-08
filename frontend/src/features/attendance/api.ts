import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type {
  Arrangement,
  ArrangementInput,
  ArrangementOnCalendar,
  AttendanceMonth,
  Correction,
  CorrectionInput,
  LeaveBalance,
  LeaveOnCalendar,
  LeaveRequest,
  LeaveRequestInput,
  LeaveType,
  Overtime,
  OvertimeInput,
} from './types'

const leavesKey = ['leaves', 'me'] as const
const balanceKey = ['leaves', 'balance'] as const

export function useLeaveTypes() {
  return useQuery({
    queryKey: ['leave-types'],
    queryFn: () => api<{ items: LeaveType[] }>('/leave-types'),
    staleTime: Infinity,
  })
}

export function useLeaveBalance() {
  return useQuery({
    queryKey: balanceKey,
    queryFn: () => api<LeaveBalance>('/leaves/balance'),
  })
}

export function useMyLeaves() {
  return useQuery({
    queryKey: leavesKey,
    queryFn: () => api<{ items: LeaveRequest[] }>('/leaves?scope=me'),
  })
}

/**
 * 전 직원의 승인된 휴가(홈 캘린더). 04 §10.2 의 scope 는 `me|team` 뿐이라 `all` 은 프론트 확장(PR 본문).
 * `from`·`to` 는 ISO 날짜. 기간이 겹치는 승인 건을 `LeaveOnCalendar` 모양으로 돌려준다.
 */
export function useAllLeaves(from: string, to: string) {
  return useQuery({
    queryKey: ['leaves', 'all', { from, to }],
    queryFn: () => api<{ items: LeaveOnCalendar[] }>(`/leaves?scope=all&from=${from}&to=${to}`),
  })
}

/** 신청·취소 뒤에는 잔여와 목록이 같이 바뀐다. 둘 다 다시 읽는다. */
function useRefetchLeaves() {
  const qc = useQueryClient()
  return () => {
    // 'leaves' 로 시작하는 키 전부(내 목록·잔여·전 직원 캘린더). 승인되면 근태 달력도 바뀐다.
    void qc.invalidateQueries({ queryKey: ['leaves'] })
    void qc.invalidateQueries({ queryKey: ['attendance'] })
  }
}

export function useRequestLeave() {
  const refetch = useRefetchLeaves()
  return useMutation({
    mutationFn: (input: LeaveRequestInput) =>
      api<LeaveRequest>('/leaves', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: refetch,
  })
}

export function useCancelLeave() {
  const refetch = useRefetchLeaves()
  return useMutation({
    mutationFn: (id: string) => api<LeaveRequest>(`/leaves/${id}/cancel`, { method: 'POST' }),
    onSuccess: refetch,
  })
}

/** 내 근태 한 달(04 §10.1). `month` 는 `2026-09`. */
export function useMyAttendance(month: string) {
  return useQuery({
    queryKey: ['attendance', 'me', month],
    queryFn: () => api<AttendanceMonth>(`/attendance/me?month=${month}`),
  })
}

// ── 예외 근무 (04 §10.3) ────────────────────────────────────────

const exceptionsKey = ['exceptions'] as const

export function useMyArrangements(enabled = true) {
  return useQuery({
    queryKey: [...exceptionsKey, 'arrangements'],
    queryFn: () => api<{ items: Arrangement[] }>('/attendance/arrangements?scope=me'),
    enabled,
  })
}

/**
 * 전 직원의 승인된 재택·외근·출장(홈 캘린더). `useAllLeaves` 와 같은 프론트 확장(`scope=all`, PR 본문).
 * 홈 캘린더는 "누가 왜 자리에 없나"를 보는 곳이라 휴가만으로는 모자란다.
 */
export function useAllArrangements(from: string, to: string) {
  return useQuery({
    queryKey: [...exceptionsKey, 'arrangements-all', { from, to }],
    queryFn: () =>
      api<{ items: ArrangementOnCalendar[] }>(
        `/attendance/arrangements?scope=all&from=${from}&to=${to}`,
      ),
  })
}

/** 내 연장근로 목록과 누계. `from`·`to` 는 ISO 날짜(양끝 포함). */
export function useMyOvertime(from: string, to: string) {
  return useQuery({
    queryKey: [...exceptionsKey, 'overtime', { from, to }],
    queryFn: () =>
      api<{
        items: Overtime[]
        summary: { minutes: number; night_minutes: number }
      }>(`/attendance/overtime?from=${from}&to=${to}`),
  })
}

export function useMyCorrections() {
  return useQuery({
    queryKey: [...exceptionsKey, 'corrections'],
    queryFn: () => api<{ items: Correction[] }>('/attendance/corrections'),
  })
}

/** 신청·취소 뒤에는 목록과(승인되면) 근태 달력이 바뀐다. */
function useRefetchExceptions() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: exceptionsKey })
    void qc.invalidateQueries({ queryKey: ['attendance'] })
  }
}

export function useRequestArrangement() {
  const refetch = useRefetchExceptions()
  return useMutation({
    mutationFn: (input: ArrangementInput) =>
      api<Arrangement>('/attendance/arrangements', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: refetch,
  })
}

export function useRequestOvertime() {
  const refetch = useRefetchExceptions()
  return useMutation({
    mutationFn: (input: OvertimeInput) =>
      api<Overtime>('/attendance/overtime', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: refetch,
  })
}

export function useRequestCorrection() {
  const refetch = useRefetchExceptions()
  return useMutation({
    mutationFn: (input: CorrectionInput) =>
      api<Correction>('/attendance/corrections', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: refetch,
  })
}

export type ExceptionKind = 'arrangement' | 'overtime' | 'correction'

const CANCEL_PATH: Record<ExceptionKind, string> = {
  arrangement: 'arrangements',
  overtime: 'overtime',
  correction: 'corrections',
}

/**
 * 승인 전 취소. 04 에는 휴가(`/leaves/{id}/cancel`)만 있고 예외 근무의 취소 경로는 없다.
 * 같은 모양으로 가정한 프론트 확장(PR 본문). 결재 편입(13)이 확정되면 `/approvals/{id}/cancel` 로 바뀔 수 있다.
 */
export function useCancelException() {
  const refetch = useRefetchExceptions()
  return useMutation({
    mutationFn: ({ kind, id }: { kind: ExceptionKind; id: string }) =>
      api<unknown>(`/attendance/${CANCEL_PATH[kind]}/${id}/cancel`, {
        method: 'POST',
      }),
    onSuccess: refetch,
  })
}
