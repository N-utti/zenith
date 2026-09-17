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
      invalidateLists(qc, boardId)
      /*
       * 지운 글의 상세를 `removeQueries` 로 치우면 안 된다. 아직 이 화면이 그 쿼리를 보고
       * 있어서, 지우는 순간 쿼리가 새로 만들어지며 이미 없는 글에 GET 이 한 번 더 나간다
       * (브라우저 네트워크 탭에서 404 를 확인했다. setTimeout 으로 미뤄도 화면이 빠지는
       * 쪽이 더 늦어 소용없다).
       *
       * `refetchType: 'none'` 은 다시 부르지 않고 stale 표시만 남긴다. 그래서 지금은 조용하고,
       * 나중에 그 주소를 다시 열면 그때 받아 와 404 화면으로 간다. staleTime 30초 안에 다시
       * 열어도 지운 글이 살아 있는 것처럼 보이지 않는다.
       */
      void qc.invalidateQueries({ queryKey: ['posts', postId], refetchType: 'none' })
    },
  })
}
