import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { Board, BoardPost, BoardPostDetail } from './types'

export function useBoards() {
  return useQuery({
    queryKey: ['boards'],
    queryFn: () => api<{ items: Board[] }>('/boards'),
    // 게시판 목록과 등급은 세션 중에 바뀌지 않는다.
    staleTime: Infinity,
  })
}

export function usePosts(boardId: string) {
  return useQuery({
    queryKey: ['boards', boardId, 'posts'],
    queryFn: () => api<{ items: BoardPost[] }>(`/boards/${boardId}/posts`),
    enabled: Boolean(boardId),
  })
}

export function usePost(postId: string) {
  return useQuery({
    queryKey: ['posts', postId],
    queryFn: () => api<BoardPostDetail>(`/posts/${postId}`),
    enabled: Boolean(postId),
    // 403은 권한 문제라 다시 시도해도 같다. 재시도가 오히려 오해를 만든다.
    retry: false,
  })
}

export function useCreatePost(boardId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { title: string; body: string }) =>
      api<BoardPostDetail>(`/boards/${boardId}/posts`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['boards', boardId, 'posts'] })
      // 홈 공지 카드도 같은 데이터를 본다.
      void qc.invalidateQueries({ queryKey: ['announcements'] })
    },
  })
}

/** 제목이 바뀌거나 글이 사라지면 같이 흔들리는 목록들. 홈 공지 카드도 같은 데이터를 본다. */
function invalidateLists(qc: ReturnType<typeof useQueryClient>, boardId: string) {
  void qc.invalidateQueries({ queryKey: ['boards', boardId, 'posts'] })
  void qc.invalidateQueries({ queryKey: ['announcements'] })
}

export function useUpdatePost(boardId: string, postId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { title: string; body: string }) =>
      api<BoardPostDetail>(`/posts/${postId}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    onSuccess: (post) => {
      qc.setQueryData(['posts', postId], post)
      invalidateLists(qc, boardId)
    },
  })
}

export function useDeletePost(boardId: string, postId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api<void>(`/posts/${postId}`, { method: 'DELETE' }),
    onSuccess: () => {
      // 지운 글의 상세는 캐시에서 빼 둔다. 뒤로 가기로 돌아와도 살아 있는 것처럼 보이면 안 된다.
      qc.removeQueries({ queryKey: ['posts', postId] })
      invalidateLists(qc, boardId)
    },
  })
}
