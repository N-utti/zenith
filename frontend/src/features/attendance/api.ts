import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { AttendanceSummary, TeamAlert } from './types'

export const attendanceKeys = {
  summary: ['attendance', 'summary'] as const,
  teamAlerts: ['attendance', 'team-alerts'] as const,
}

export function useAttendanceSummary() {
  return useQuery({
    queryKey: attendanceKeys.summary,
    queryFn: () => api<AttendanceSummary>('/attendance/summary'),
  })
}

/** 출근·퇴근 버튼. 서버가 갱신된 요약을 그대로 돌려주므로 캐시에 바로 꽂는다. */
export function usePunch(kind: 'check-in' | 'check-out') {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api<AttendanceSummary>(`/attendance/${kind}`, { method: 'POST' }),
    onSuccess: (summary) => {
      qc.setQueryData(attendanceKeys.summary, summary)
      void qc.invalidateQueries({ queryKey: attendanceKeys.teamAlerts })
    },
  })
}

/**
 * 퇴근 취소. 유예를 넘겼으면 서버가 409와 함께 보정 경로를 안내한다.
 * 기록을 지우는 게 아니라 취소 이벤트를 덧붙이는 것이므로 원본은 남는다.
 */
export function useUndoCheckOut() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api<AttendanceSummary>('/attendance/check-out/undo', { method: 'POST' }),
    onSuccess: (summary) => {
      qc.setQueryData(attendanceKeys.summary, summary)
      void qc.invalidateQueries({ queryKey: attendanceKeys.teamAlerts })
    },
  })
}

export function useTeamAlerts(enabled: boolean) {
  return useQuery({
    queryKey: attendanceKeys.teamAlerts,
    queryFn: () => api<{ alerts: TeamAlert[] }>('/attendance/team-alerts'),
    enabled,
  })
}
