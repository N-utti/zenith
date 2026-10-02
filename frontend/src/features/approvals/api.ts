import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { MSW_ENABLED } from '@/mocks/accounts'
import type {
  ApprovalAttachment,
  ApprovalBox,
  Delegation,
  DelegationInput,
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

/**
 * 임시저장 지우기를 보일지. 서버에는 아직 그 경로가 없어서(13 §9.3 의 임시저장은 만들기와
 * 고치기뿐) 목이 켜진 개발 화면에서만 보인다. 서버가 받게 되면 이 스위치를 걷는다.
 */
export const DRAFT_DELETE_ENABLED = MSW_ENABLED

/** 임시저장을 지운다. 내 것, 상신 전인 것만(상신한 문서는 409). */
export function useDeleteDraft() {
  const refetch = useRefetchApprovals()
  return useMutation({
    mutationFn: (id: string) => api<void>(`/approvals/drafts/${id}`, { method: 'DELETE' }),
    // 실패해도 다시 읽는다. 다른 탭에서 이미 상신했거나 지운 문서면 이 목록이 옛것이다.
    onSettled: refetch,
  })
}

/**
 * 첨부 한 개를 임시저장 문서에 올린다. 받은 값을 `subject.attachments` 에 넣어 저장해야 붙는다.
 *
 * 훅이 아니라 함수다. 여러 개를 차례로 올릴 때 `useMutation` 의 `mutate` 를 반복해 부르면
 * 앞선 호출의 콜백이 떨어진다(채팅 `uploadAttachment` 와 같은 이유).
 */
export function uploadApprovalAttachment(id: string, file: File): Promise<ApprovalAttachment> {
  const form = new FormData()
  form.append('file', file)
  return api<ApprovalAttachment>(`/approvals/${id}/attachments`, { method: 'POST', body: form })
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

/**
 * 강제 종결(13 §9.2). 임원만, 대기 중인 문서만. 사유는 필수고 감사 기록에 남는다.
 *
 * 결재자가 자리를 비웠거나 퇴사해 문서가 영영 대기로 남는 경우를 끝내는 길이다. 기안자의
 * 회수(`cancel`)와 달리 남의 문서도 끝낼 수 있어서, 사유 없이는 보내지 않는다.
 */
export function useForceCloseApproval() {
  const refetch = useRefetchApprovals()
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api<ApprovalDocument>(`/approvals/${id}/force-close`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      }),
    onSuccess: refetch,
  })
}

const delegationsKey = ['approvals', 'delegations'] as const

/** 내가 건 위임 목록(13 §9.3). 남의 위임은 안 보인다. */
export function useDelegations() {
  return useQuery({
    queryKey: delegationsKey,
    queryFn: () => api<{ items: Delegation[] }>('/approvals/delegations'),
  })
}

export function useCreateDelegation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: DelegationInput) =>
      api<Delegation>('/approvals/delegations', { method: 'POST', body: JSON.stringify(input) }),
    // 내 받은 결재함도 달라진다(위임을 걸면 내 차례가 남에게 넘어간다). 결재 캐시를 통째로 비운다.
    onSuccess: () => void qc.invalidateQueries({ queryKey: approvalsKey }),
  })
}

export function useDeleteDelegation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<void>(`/approvals/delegations/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: approvalsKey }),
  })
}
