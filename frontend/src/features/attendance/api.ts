import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type {
  LeaveBalance,
  LeaveOnCalendar,
  LeaveRequest,
  LeaveRequestInput,
  LeaveType,
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
    // 'leaves' 로 시작하는 키 전부(내 목록·잔여·전 직원 캘린더).
    void qc.invalidateQueries({ queryKey: ['leaves'] })
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
