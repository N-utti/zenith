import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type {
  Activity,
  ActivityInput,
  Contact,
  ContactInput,
  Deal,
  DealDetail,
  DealInput,
  DealKind,
  DealStatus,
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

export function useOrgs(filter: OrgFilter, enabled = true) {
  const params = new URLSearchParams()
  if (filter.q.trim()) params.set('q', filter.q.trim())
  if (filter.type) params.set('type', filter.type)
  if (filter.owner) params.set('owner', filter.owner)
  if (filter.staleDays) params.set('stale_days', String(filter.staleDays))
  const query = params.toString()
  return useQuery({
    queryKey: [...crmKey, 'orgs', query],
    enabled,
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

/** 기관 또는 안건의 활동 타임라인. 안건에 건 기록은 기관 쪽에도 뜬다. */
export function useActivities(target: { orgId: string } | { dealId: string }) {
  const [kind, id] = 'orgId' in target ? ['org', target.orgId] : ['deal', target.dealId]
  return useQuery({
    queryKey: [...crmKey, 'activities', kind, id],
    queryFn: () =>
      api<{ items: Activity[]; next_cursor: string | null }>(
        `/crm/activities?${kind}_id=${encodeURIComponent(id)}`,
      ),
    enabled: id.length > 0,
  })
}

export function useDeals(filter: { kind?: DealKind; status?: DealStatus; orgId?: string }) {
  const params = new URLSearchParams()
  if (filter.kind) params.set('kind', filter.kind)
  if (filter.status) params.set('status', filter.status)
  if (filter.orgId) params.set('org_id', filter.orgId)
  const query = params.toString()
  return useQuery({
    queryKey: [...crmKey, 'deals', query],
    queryFn: () => api<{ items: Deal[]; next_cursor: string | null }>(`/crm/deals?${query}`),
  })
}

export function useDeal(id: string) {
  return useQuery({
    queryKey: [...crmKey, 'deal', id],
    queryFn: () => api<DealDetail>(`/crm/deals/${id}`),
    enabled: id.length > 0,
  })
}

/** 약속을 돌려준다. `onSettled` 가 다시 읽기를 기다려야 새 version 이 오기 전에 버튼이 풀리지 않는다. */
function useRefetchCrm() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: crmKey })
}

/**
 * 안건을 바꾸는 요청의 뒷정리. 응답(새 version)을 상세 캐시에 바로 넣고 전체를 다시 읽는다.
 * 넣지 않으면 다시 읽기가 끝날 때까지 화면이 옛 version·옛 상태를 들고 있어, 그 사이에 한 번 더
 * 누르면 내가 만든 409 가 «다른 사람이 먼저 고쳤습니다» 로 뜬다.
 */
function useSettleDeal() {
  const qc = useQueryClient()
  return (data: DealDetail | undefined) => {
    if (data) qc.setQueryData([...crmKey, 'deal', data.id], data)
    return qc.invalidateQueries({ queryKey: crmKey })
  }
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
    // 지운 기관과 그 안건의 상세·활동은 다시 부르면 404 뿐이다. 캐시에서 걷어내고 목록만 새로
    // 읽는다. 전체를 무효화하면 아직 떠 있는 기관 상세가 404 를 다시 부른다.
    onSuccess: (_, { id }) => {
      const dealIds = qc
        .getQueriesData<DealDetail>({ queryKey: [...crmKey, 'deal'] })
        .flatMap(([, deal]) => (deal?.org.id === id ? [deal.id] : []))
      for (const dealId of dealIds) {
        qc.removeQueries({ queryKey: [...crmKey, 'deal', dealId] })
        qc.removeQueries({ queryKey: [...crmKey, 'activities', 'deal', dealId] })
      }
      qc.removeQueries({ queryKey: [...crmKey, 'org', id] })
      qc.removeQueries({ queryKey: [...crmKey, 'activities', 'org', id] })
      void qc.invalidateQueries({ queryKey: [...crmKey, 'orgs'] })
      void qc.invalidateQueries({ queryKey: [...crmKey, 'deals'] })
    },
  })
}

/**
 * 수정에서 `org_id` 를 보내면 서버가 이직으로 기록한다(15 FR-CRM-04). 옮길 때만 보낸다 — 늘 보내면
 * 그사이 다른 사람이 옮겨 둔 담당자를 전화번호만 고치다가 옛 기관으로 되돌린다.
 */
export function useSaveContact() {
  const refetch = useRefetchCrm()
  return useMutation({
    mutationFn: ({
      id,
      ...input
    }: Omit<ContactInput, 'org_id'> & { id?: string; org_id?: string }) =>
      id
        ? api<Contact>(`/crm/contacts/${id}`, json('PATCH', input))
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

export function useCreateDeal() {
  const refetch = useRefetchCrm()
  return useMutation({
    mutationFn: (input: DealInput) => api<DealDetail>('/crm/deals', json('POST', input)),
    onSuccess: refetch,
  })
}

type DealPatch = Partial<Omit<DealInput, 'kind' | 'org_id'>> & { stage?: string }

/**
 * 수정·단계 이동. 받아 둔 `version` 을 같이 보내고, 남이 먼저 고쳤으면 409 다(15 NFR-CRM-02).
 * 409 도 다시 읽는다. 보드의 단계 선택은 새로 읽은 version 으로 다시 시도할 수 있다.
 * 수정 창은 연 순간의 version 을 끝까지 들고 있으므로 다시 읽어도 덮어쓰지 않는다(`DealFormModal`).
 */
export function useUpdateDeal() {
  const settle = useSettleDeal()
  return useMutation({
    mutationFn: ({ id, ...patch }: DealPatch & { id: string; version: number }) =>
      api<DealDetail>(`/crm/deals/${id}`, json('PATCH', patch)),
    onSettled: settle,
  })
}

/** 중단. 사유 필수(15 FR-CRM-12). */
export function useDropDeal() {
  const settle = useSettleDeal()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; reason: string; version: number }) =>
      api<DealDetail>(`/crm/deals/${id}/drop`, json('POST', body)),
    onSettled: settle,
  })
}

/** 재개. 중단된 안건만(15 §6). */
export function useReopenDeal() {
  const settle = useSettleDeal()
  return useMutation({
    mutationFn: ({ id, version }: { id: string; version: number }) =>
      api<DealDetail>(`/crm/deals/${id}/reopen`, json('POST', { version })),
    onSettled: settle,
  })
}
