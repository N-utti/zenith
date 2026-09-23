import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { Schema } from '@/types'

/**
 * 서버에 남는 환경설정(`GET/PATCH /me/preferences`, 04 밖: backend/README "설계와 어긋나는 것" 17).
 *
 * 테마·사이드바·문서 트리는 기기마다 달라도 되는 값이라 여기 없고 브라우저에 둔다.
 */
export type Preferences = Schema<'Preferences'>

export type NotificationKind = keyof Preferences['notifications']

export type StartPage = Preferences['start_page']

/** 준 것만 덮어쓴다. 서버는 모르는 키를 422 로 막는다. */
export type PreferencesPatch = Schema<'PreferencesPatch'>

export const START_PAGES: { value: StartPage; label: string }[] = [
  { value: '/', label: '홈' },
  { value: '/docs', label: '문서' },
  { value: '/chat', label: '채팅' },
  { value: '/board', label: '게시판' },
  { value: '/attendance', label: '근태' },
]

const preferencesKey = ['me', 'preferences'] as const

export const fetchPreferences = () => api<Preferences>('/me/preferences')

export function usePreferences() {
  return useQuery({ queryKey: preferencesKey, queryFn: fetchPreferences })
}

/** 서버가 합친 전체를 돌려주므로 그걸 그대로 캐시에 앉힌다. 다시 부를 필요가 없다. */
export function useUpdatePreferences() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (patch: PreferencesPatch) =>
      api<Preferences>('/me/preferences', { method: 'PATCH', body: JSON.stringify(patch) }),
    onSuccess: (saved) => qc.setQueryData(preferencesKey, saved),
  })
}
