import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type {
  Activity,
  ActivityInput,
  Contact,
  ContactInput,
  OrgCreated,
  OrgDetail,
  OrgInput,
  OrgListItem,
} from './types'

/** 기관·담당자·활동이 서로의 화면에 숫자로 걸려 있다(담당자 수·마지막 연락). 한 키 아래 둔다. */
const crmKey = ['crm'] as const

export interface OrgFilter {
  q: string
  type: string
  owner: string
  staleDays: number
}

export function useOrgs(filter: OrgFilter) {
  const params = new URLSearchParams()
  if (filter.q.trim()) params.set('q', filter.q.trim())
  if (filter.type) params.set('type', filter.type)
  if (filter.owner) params.set('owner', filter.owner)
  if (filter.staleDays) params.set('stale_days', String(filter.staleDays))
  const query = params.toString()
  return useQuery({
    queryKey: [...crmKey, 'orgs', query],
    queryFn: () =>
      api<{ items: OrgListItem[]; next_cursor: string | null }>(
        `/crm/orgs${query ? `?${query}` : ''}`,
      ),
    // 검색어를 칠 때마다 표가 스켈레톤으로 깜빡이지 않게 앞 결과를 들고 있는다.
    placeholderData: (previous) => previous,
  })
}

export function useOrg(id: string) {
  return useQuery({
    queryKey: [...crmKey, 'org', id],
    queryFn: () => api<OrgDetail>(`/crm/orgs/${id}`),
    enabled: id.length > 0,
  })
}

export function useActivities(orgId: string) {
  return useQuery({
    queryKey: [...crmKey, 'activities', orgId],
    queryFn: () =>
      api<{ items: Activity[]; next_cursor: string | null }>(`/crm/activities?org_id=${orgId}`),
    enabled: orgId.length > 0,
  })
}

function useRefetchCrm() {
  const qc = useQueryClient()
  return () => void qc.invalidateQueries({ queryKey: crmKey })
}

const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body) })

export function useCreateOrg() {
  const refetch = useRefetchCrm()
  return useMutation({
    mutationFn: (input: OrgInput) => api<OrgCreated>('/crm/orgs', json('POST', input)),
    onSuccess: refetch,
  })
}

export function useUpdateOrg() {
  const refetch = useRefetchCrm()
  return useMutation({
    mutationFn: ({ id, ...patch }: Partial<OrgInput> & { id: string }) =>
      api<OrgDetail>(`/crm/orgs/${id}`, json('PATCH', patch)),
    onSuccess: refetch,
  })
}

/** 임원만, 사유 필수(15 §3). */
export function useDeleteOrg() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api<void>(`/crm/orgs/${id}`, json('DELETE', { reason })),
    // 지운 기관의 상세·활동은 다시 부르면 404 뿐이다. 캐시에서 걷어내고 목록만 새로 읽는다.
    onSuccess: (_, { id }) => {
      qc.removeQueries({ queryKey: [...crmKey, 'org', id] })
      qc.removeQueries({ queryKey: [...crmKey, 'activities', id] })
      void qc.invalidateQueries({ queryKey: [...crmKey, 'orgs'] })
    },
  })
}

export function useSaveContact() {
  const refetch = useRefetchCrm()
  return useMutation({
    mutationFn: ({ id, ...input }: ContactInput & { id?: string }) =>
      id
        ? api<Contact>(`/crm/contacts/${id}`, json('PATCH', { ...input, org_id: undefined }))
        : api<Contact>('/crm/contacts', json('POST', input)),
    onSuccess: refetch,
  })
}

/** 개인정보 삭제. 임원만(15 FR-CRM-06). 연락처만 비우고 활동 기록은 남는다. */
export function useEraseContact() {
  const refetch = useRefetchCrm()
  return useMutation({
    mutationFn: (id: string) => api<Contact>(`/crm/contacts/${id}/erase`, { method: 'POST' }),
    onSuccess: refetch,
  })
}

export function useSaveActivity() {
  const refetch = useRefetchCrm()
  return useMutation({
    mutationFn: ({ id, ...input }: ActivityInput & { id?: string }) =>
      id
        ? api<Activity>(`/crm/activities/${id}`, json('PATCH', { ...input, org_id: undefined }))
        : api<Activity>('/crm/activities', json('POST', input)),
    onSuccess: refetch,
  })
}

export function useDeleteActivity() {
  const refetch = useRefetchCrm()
  return useMutation({
    mutationFn: (id: string) => api<void>(`/crm/activities/${id}`, { method: 'DELETE' }),
    onSuccess: refetch,
  })
}
