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
    queryFn: async () => {
      const hits = await api<SearchHit[]>(`/search?q=${encodeURIComponent(q)}`)
      // 배열이 아닌 게 오면 조용히 빈 목록이 되는 대신 여기서 끊는다. 목록 길이로 커서를
      // 세기 때문에, undefined 가 흘러가면 팔레트 전체가 조작 불가로 굳는다.
      if (!Array.isArray(hits)) throw new Error('검색 응답이 배열이 아닙니다.')
      return hits
    },
    enabled: q.length > 0 && q.length <= SEARCH_MAX,
    // 글자를 지우거나 이어 칠 때 목록이 비었다가 다시 차면 커서가 튄다.
    placeholderData: keepPreviousData,
    // 같은 검색어를 다시 열면 그대로 쓴다. 검색 결과가 몇 초 사이에 바뀔 일은 드물다.
    staleTime: 30_000,
    // 창을 다녀오는 사이에 결과 개수가 바뀌면, 키보드 커서가 가리키던 행이 다른 행이 된다.
    // AI 행에 올려 둔 커서가 검색 결과 한가운데를 가리키게 되는 식이다. 팔레트는 열 때마다
    // 새로 마운트되므로 다시 받아 올 이유도 없다.
    refetchOnWindowFocus: false,
  })
}
