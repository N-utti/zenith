import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type {
  ApprovalBox,
  ApprovalDocument,
  ApprovalListItem,
  ApprovalType,
  DraftInput,
} from './types'

const approvalsKey = ['approvals'] as const

export function useApprovalTypes() {
  return useQuery({
    queryKey: ['approval-types'],
    queryFn: () => api<{ items: ApprovalType[] }>('/approval-types'),
    staleTime: Infinity,
  })
}

/** 결재함(13 §9.3). `inbox` 는 내 차례인 문서, `sent` 는 내가 기안한 문서. */
export function useApprovals(box: ApprovalBox) {
  return useQuery({
    queryKey: [...approvalsKey, 'box', box],
    queryFn: () =>
      api<{ items: ApprovalListItem[]; next_cursor: string | null }>(`/approvals?box=${box}`),
    // 근태 화면도 결의서 배지 때문에 읽는다. 화면을 오갈 때마다 다시 부르지 않게 잠깐 신선하게 둔다.
    staleTime: 30_000,
  })
}

export function useApproval(id: string) {
  return useQuery({
    queryKey: [...approvalsKey, 'doc', id],
    queryFn: () => api<ApprovalDocument>(`/approvals/${id}`),
    enabled: id.length > 0,
  })
}

/** 기안·상신·처리 뒤에는 결재함과 문서가 같이 바뀐다. 전부 다시 읽는다. */
function useRefetchApprovals() {
  const qc = useQueryClient()
  return () => void qc.invalidateQueries({ queryKey: approvalsKey })
}

export function useCreateDraft() {
  const refetch = useRefetchApprovals()
  return useMutation({
    mutationFn: (input: DraftInput) =>
      api<ApprovalDocument>('/approvals/drafts', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: refetch,
  })
}

export function useUpdateDraft() {
  const refetch = useRefetchApprovals()
  return useMutation({
    mutationFn: ({ id, ...input }: DraftInput & { id: string }) =>
      api<ApprovalDocument>(`/approvals/drafts/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    onSuccess: refetch,
  })
}

/** 상신. 결재선이 이 시점에 고정된다(13 §4.2.2). 도메인 사전검증 실패는 422. */
export function useSubmitApproval() {
  const refetch = useRefetchApprovals()
  return useMutation({
    mutationFn: (id: string) =>
      api<ApprovalDocument>(`/approvals/${id}/submit`, { method: 'POST' }),
    onSuccess: refetch,
  })
}

/** 회수. 이미 승인된 단계가 있으면 409(13 FR-APV-06). */
export function useCancelApproval() {
  const refetch = useRefetchApprovals()
  return useMutation({
    mutationFn: (id: string) =>
      api<ApprovalDocument>(`/approvals/${id}/cancel`, { method: 'POST' }),
    onSuccess: refetch,
  })
}

export function useApproveStep() {
  const refetch = useRefetchApprovals()
  return useMutation({
    mutationFn: ({ id, version, comment }: { id: string; version: number; comment?: string }) =>
      api<ApprovalDocument>(`/approvals/${id}/approve`, {
        method: 'POST',
        body: JSON.stringify({ version, ...(comment ? { comment } : {}) }),
      }),
    onSuccess: refetch,
  })
}

/** 반려. 사유가 없으면 400(13 FR-APV-11). */
export function useRejectStep() {
  const refetch = useRefetchApprovals()
  return useMutation({
    mutationFn: ({ id, version, reason }: { id: string; version: number; reason: string }) =>
      api<ApprovalDocument>(`/approvals/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ version, reason }),
      }),
    onSuccess: refetch,
  })
}
