import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { SearchHit } from './types'

/** 백엔드 `q` 는 1자 이상 200자 이하다. 넘겨 봐야 422 라 보내지 않는다. */
export const SEARCH_MAX = 200

export function useSearch(query: string) {
  const q = query.trim()
  return useQuery({
    queryKey: ['search', q],
    // 응답이 `{items}` 가 아니라 배열 그대로다.
    queryFn: () => api<SearchHit[]>(`/search?q=${encodeURIComponent(q)}`),
    enabled: q.length > 0 && q.length <= SEARCH_MAX,
    // 글자를 지우거나 이어 칠 때 목록이 비었다가 다시 차면 커서가 튄다.
    placeholderData: keepPreviousData,
    // 같은 검색어를 다시 열면 그대로 쓴다. 검색 결과가 몇 초 사이에 바뀔 일은 드물다.
    staleTime: 30_000,
  })
}
