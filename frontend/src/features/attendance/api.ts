import { useMemo } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { downloadBytes } from '@/lib/download'
import { buildXlsx } from '@/lib/xlsx'
import { REPORT_FIXED_COLS, reportRows } from './report'
import { toISODate } from '@/lib/datetime'
import type {
  Arrangement,
  ArrangementInput,
  ArrangementKind,
  ArrangementOnCalendar,
  AttendanceGrid,
  AttendanceMonth,
  AttendanceRange,
  Correction,
  CorrectionInput,
  Holiday,
  HolidayInput,
  LeaveBalance,
  LeaveBalanceRow,
  LeaveOnCalendar,
  LeaveRequest,
  LeaveRequestInput,
  LeaveType,
  MonthClosing,
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

/** 전 직원의 연차 잔여(연차 관리 탭). `/leaves/balances` 는 04 에 없는 프론트 확장(PR 본문). 임원 외 403. */
export function useAllLeaveBalances() {
  return useQuery({
    queryKey: ['leaves', 'balances'],
    queryFn: () => api<{ items: LeaveBalanceRow[] }>('/leaves/balances'),
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

/**
 * 기간 집계. 달을 넘어가는 누계를 볼 때 쓴다(연장근로·휴가는 해 단위로 관리한다).
 *
 * 날짜가 비었거나 거꾸로면 부르지 않는다. 서버는 422 인데, 고르는 중에 매번 빨간 문구를
 * 띄울 이유가 없다.
 */
export function useAttendanceRange(from: string, to: string) {
  return useQuery({
    queryKey: ['attendance', 'me', 'summary', { from, to }],
    queryFn: () =>
      api<AttendanceRange>(
        `/attendance/me/summary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      ),
    enabled: from !== '' && to !== '' && from <= to,
    // 날짜를 고칠 때마다 키가 바뀐다. 이전 값을 두지 않으면 숫자가 사라졌다 나타난다(전사 근태와 같다).
    placeholderData: keepPreviousData,
  })
}

/** 내 근태 한 달(04 §10.1). `month` 는 `2026-09`. */
export function useMyAttendance(month: string) {
  return useQuery({
    queryKey: ['attendance', 'me', month],
    queryFn: () => api<AttendanceMonth>(`/attendance/me?month=${month}`),
  })
}

/** 전 직원 × 일자 근태(전사 근태 탭). `team_id` 없는 호출은 전사로 가정한 프론트 확장, 임원 외 403. */
export function useCompanyAttendance(month: string) {
  return useQuery({
    queryKey: ['attendance', 'company', month],
    queryFn: () => api<AttendanceGrid>(`/attendance/team?month=${encodeURIComponent(month)}`),
    // 달을 넘길 때 13줄이 통째로 사라졌다 다시 생기지 않게 이전 달 표를 붙들고 있는다.
    placeholderData: keepPreviousData,
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

/**
 * 오늘 재택·외근·출장 중인 사람의 id → 종류. 채팅 DM 행 옆에 "재택" 같은 근무 상태를 붙일 때 쓴다.
 * 같은 사람이 겹치면 먼저 온 것 하나만 남는다(승인된 예외 근무는 하루에 하나가 정상).
 * 날짜는 렌더 때 계산한다. 자정을 넘겨도 재렌더 전에는 어제 키로 남지만 채팅 갱신이 잦아 곧 바뀐다.
 */
export function useTodayArrangementKinds() {
  const today = toISODate(new Date())
  const { data } = useAllArrangements(today, today)
  return useMemo(() => {
    const map = new Map<string, ArrangementKind>()
    for (const item of data?.items ?? [])
      if (!map.has(item.user.id)) map.set(item.user.id, item.kind)
    return map
  }, [data])
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

// ── 월 마감 (10 §9.5) ──────────────────────────────────────────

const closingKey = (month: string) => ['attendance', 'closing', month] as const
const yearClosingsKey = (year: number) => ['attendance', 'closings', year] as const

export function useMonthClosing(month: string) {
  return useQuery({
    queryKey: closingKey(month),
    queryFn: () => api<MonthClosing>(`/attendance/closings/${month}`),
  })
}

/** 한 해 열두 달의 마감 상태(근태 관리 탭). `GET /attendance/closings?year=` 도 프론트 확장. */
export function useYearClosings(year: number) {
  return useQuery({
    queryKey: yearClosingsKey(year),
    queryFn: () => api<{ items: MonthClosing[] }>(`/attendance/closings?year=${year}`),
    placeholderData: keepPreviousData,
  })
}

/** 응답이 곧 그 달의 새 상태다. 달 하나와 그 해 목록 두 캐시에 바로 넣는다. 집계는 안 바뀌니 더 무효화하지 않는다. */
function useSetClosing() {
  const qc = useQueryClient()
  return (item: MonthClosing) => {
    qc.setQueryData(closingKey(item.month), item)
    qc.setQueryData(
      yearClosingsKey(Number(item.month.slice(0, 4))),
      (prev?: { items: MonthClosing[] }) =>
        prev && { items: prev.items.map((c) => (c.month === item.month ? item : c)) },
    )
  }
}

export function useCloseMonth() {
  const set = useSetClosing()
  return useMutation({
    mutationFn: (month: string) =>
      api<MonthClosing>('/attendance/close', { method: 'POST', body: JSON.stringify({ month }) }),
    onSuccess: set,
  })
}

export function useReopenMonth() {
  const set = useSetClosing()
  return useMutation({
    mutationFn: (input: { month: string; reason: string }) =>
      api<MonthClosing>('/attendance/reopen', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: set,
  })
}

/**
 * 월 리포트 xlsx(FR-ATT-15, 임원). 전사 그리드(`/attendance/team`)를 받아 브라우저가 만든다.
 * 열 고정·열 너비 같은 서식이 필요해 CSV 로는 안 된다(report.ts).
 */
export function useDownloadReport() {
  return useMutation({
    mutationFn: async (month: string) => {
      // 캐시를 안 쓴다. 내려받는 파일은 그 순간의 서버 값이어야 한다.
      const grid = await api<AttendanceGrid>(`/attendance/team?month=${encodeURIComponent(month)}`)
      const bytes = buildXlsx(reportRows(grid), { sheet: month, freezeCols: REPORT_FIXED_COLS })
      downloadBytes(
        `attendance-${month}.xlsx`,
        bytes,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      )
    },
  })
}

// ── 공휴일·회사 휴일 (10 §9.6, 임원) ────────────────────────────

const holidaysKey = (year: number) => ['holidays', year] as const

/** `?year=` 은 프론트 확장(PR 본문). 10 §9.6 은 GET/POST 만 적었다. */
export function useHolidays(year: number) {
  return useQuery({
    queryKey: holidaysKey(year),
    queryFn: () => api<{ items: Holiday[] }>(`/admin/holidays?year=${year}`),
    placeholderData: keepPreviousData,
  })
}

/** 휴일이 바뀌면 근무 달력이 다시 만들어진다(10 §6.2). 근태 달력·그리드도 같이 다시 읽는다. */
function useRefetchHolidays() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: ['holidays'] })
    void qc.invalidateQueries({ queryKey: ['attendance'] })
  }
}

export function useAddHoliday() {
  const refetch = useRefetchHolidays()
  return useMutation({
    mutationFn: (input: HolidayInput) =>
      api<Holiday>('/admin/holidays', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: refetch,
  })
}

/**
 * 근무 달력 다시 만들기(10 §6.2 `POST /admin/attendance/calendar/rebuild`).
 *
 * 휴일을 넣고 빼면 서버가 알아서 다시 만든다. 이건 그 자동 경로를 못 탄 경우를 위한 손잡이다.
 * 새해 달력을 미리 깔거나, 서버 밖에서 휴일이 바뀌었을 때 쓴다.
 */
export function useRebuildCalendar() {
  const refetch = useRefetchHolidays()
  return useMutation({
    mutationFn: (year: number) =>
      api<{ year: number; workdays: number }>('/admin/attendance/calendar/rebuild', {
        method: 'POST',
        body: JSON.stringify({ year }),
      }),
    onSuccess: refetch,
  })
}

/**
 * `PATCH /admin/holidays/{date}` 도 프론트 확장이다. 이름만 고친다. 오타 하나 때문에 지우고 다시
 * 넣으면 그사이 근무 달력이 두 번 바뀐다. 날짜는 못 바꾼다.
 */
export function useRenameHoliday() {
  const refetch = useRefetchHolidays()
  return useMutation({
    mutationFn: ({ date, name }: { date: string; name: string }) =>
      api<Holiday>(`/admin/holidays/${encodeURIComponent(date)}`, {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      }),
    onSuccess: refetch,
  })
}

/** `DELETE /admin/holidays/{date}` 는 프론트 확장(PR 본문). 잘못 넣은 날을 되돌릴 길이 있어야 한다. */
export function useRemoveHoliday() {
  const refetch = useRefetchHolidays()
  return useMutation({
    mutationFn: (date: string) =>
      api<void>(`/admin/holidays/${encodeURIComponent(date)}`, { method: 'DELETE' }),
    onSuccess: refetch,
  })
}
