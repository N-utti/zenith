import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { meQueryKey } from '@/features/auth/queries'
import type { AuditPage } from './audit'
import type { Team } from '@/types'
import type { AdminUser, UserCreate, UserPatch } from './types'

export const adminKeys = {
  users: ['admin', 'users'] as const,
  teams: ['admin', 'teams'] as const,
  /** 거르개마다 따로 캐시한다. 앞머리(`['admin','audit']`)로 한 번에 무효화한다. */
  audit: (kind: string) => ['admin', 'audit', kind] as const,
  allAudit: ['admin', 'audit'] as const,
}

/** 한 번에 받는 줄 수. 서버 상한은 200 이다. */
const AUDIT_LIMIT = 50

/**
 * 계정 목록. 서버가 이름순으로 정렬해 준다(04 §9).
 *
 * 임원만 부를 수 있는 경로다. 그 아래 등급이 부르면 403 이라 화면에서 먼저 막는다.
 */
export function useUsers() {
  return useQuery({
    queryKey: adminKeys.users,
    queryFn: () => api<AdminUser[]>('/admin/users'),
  })
}

/**
 * 팀 목록. 계정의 소속을 고르는 자리에서만 쓴다.
 *
 * 다른 목록과 달리 `{items}` 가 아니라 **배열 그대로** 온다(04 §9). 임원 전용이라 그 아래
 * 등급은 403 인데, 관리 화면 자체가 임원에게만 열리므로 여기서 또 막지 않는다.
 */
export function useTeams() {
  return useQuery({
    queryKey: adminKeys.teams,
    queryFn: () => api<Team[]>('/admin/teams'),
  })
}

/**
 * 팀 만들기(`id` 없음)와 이름 바꾸기(`id` 있음). 본문이 `{name}` 하나로 같다(04 §9 `TeamIn`).
 *
 * 이름을 바꾸면 소속 계정은 그대로고 이름만 따라간다. 프로필·전사 근태·휴가 목록이 줄마다
 * 옛 팀 이름을 들고 있으니 같이 다시 부른다. 그대로 두면 월 리포트 xlsx 에도 옛 이름이 찍힌다.
 */
export function useSaveTeam() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, name }: { id?: string; name: string }) =>
      api<Team>(id ? `/admin/teams/${id}` : '/admin/teams', {
        method: id ? 'PATCH' : 'POST',
        body: JSON.stringify({ name }),
      }),
    onSuccess: (_data, { id }) => {
      void qc.invalidateQueries({ queryKey: adminKeys.teams })
      void qc.invalidateQueries({ queryKey: adminKeys.allAudit })
      if (!id) return
      for (const queryKey of [meQueryKey, ['attendance'], ['leaves']]) {
        void qc.invalidateQueries({ queryKey })
      }
    },
  })
}

export function useCreateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: UserCreate) =>
      api<AdminUser>('/admin/users', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminKeys.users })
      // 이 요청이 서버에서 감사 줄을 만든다. 바꾸고 바로 옆 탭을 열면 그 줄이 있어야 한다.
      void qc.invalidateQueries({ queryKey: adminKeys.allAudit })
    },
  })
}

export function useUpdateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UserPatch }) =>
      api<AdminUser>(`/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    onSuccess: (_data, { id }) => {
      void qc.invalidateQueries({ queryKey: adminKeys.users })
      void qc.invalidateQueries({ queryKey: adminKeys.allAudit })
      // 내 계정을 고쳤으면 헤더·사이드바가 보는 프로필도 옛것이다. 이름을 바꿔 놓고
      // 오른쪽 위에는 옛 이름이 남으면 저장이 안 된 것처럼 보인다.
      if (id === qc.getQueryData<{ id: string } | null>(meQueryKey)?.id) {
        void qc.invalidateQueries({ queryKey: meQueryKey })
      }
    },
  })
}

/**
 * 감사 기록. 최신순 커서 페이징이라 "더 보기" 로 이어 붙인다.
 *
 * 커서는 서버가 준 불투명 문자열이다. 안을 들여다보지 않는다(시각과 id 를 담은 base64 지만
 * 그건 서버 사정이다). 첫 장은 커서 없이 부른다.
 */
export function useAudit(kind: string) {
  return useInfiniteQuery({
    queryKey: adminKeys.audit(kind),
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: String(AUDIT_LIMIT) })
      if (kind) params.set('kind', kind)
      if (pageParam) params.set('cursor', pageParam)
      return api<AuditPage>(`/admin/audit?${params}`)
    },
    initialPageParam: '',
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  })
}
