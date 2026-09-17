import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { meQueryKey } from '@/features/auth/queries'
import type { AdminUser, UserCreate, UserPatch } from './types'

export const adminKeys = {
  users: ['admin', 'users'] as const,
}

/**
 * 계정 목록. 서버가 이름순으로 정렬해 준다(04 §9).
 *
 * 임원만 부를 수 있는 경로다. 그 아래 등급이 부르면 403 이라 화면에서 먼저 막는다.
 */
export function useUsers(enabled: boolean) {
  return useQuery({
    queryKey: adminKeys.users,
    queryFn: () => api<AdminUser[]>('/admin/users'),
    enabled,
  })
}

export function useCreateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: UserCreate) =>
      api<AdminUser>('/admin/users', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: adminKeys.users }),
  })
}

export function useUpdateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UserPatch }) =>
      api<AdminUser>(`/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    onSuccess: (_data, { id }) => {
      void qc.invalidateQueries({ queryKey: adminKeys.users })
      // 내 계정을 고쳤으면 헤더·사이드바가 보는 프로필도 옛것이다. 이름을 바꿔 놓고
      // 오른쪽 위에는 옛 이름이 남으면 저장이 안 된 것처럼 보인다.
      if (id === qc.getQueryData<{ id: string } | null>(meQueryKey)?.id) {
        void qc.invalidateQueries({ queryKey: meQueryKey })
      }
    },
  })
}
