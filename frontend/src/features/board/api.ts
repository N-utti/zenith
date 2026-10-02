import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { homeKeys } from '@/features/home/keys'
import { MSW_ENABLED } from '@/mocks/accounts'
import type { Board, BoardPost, BoardPostDetail, PostAttachment, PostComment } from './types'

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

/**
 * 게시글에 파일을 붙일 수 있는지. 서버에는 아직 그 경로가 없어서(04 §6 의 글은 제목과 본문뿐이다)
 * 목이 켜진 개발 화면에서만 붙이기 버튼이 보인다. 서버가 받게 되면 이 스위치를 걷는다.
 */
export const POST_ATTACHMENTS_ENABLED = MSW_ENABLED

/** 글에 보내는 값. `attachments` 는 보낼 때 늘 전체 목록이고, 안 보내면 그대로 둔다. */
export interface PostInput {
  title: string
  body: string
  attachments?: PostAttachment[]
}

/**
 * 파일 한 개를 그 게시판에 올린다. 받은 값을 글의 `attachments` 에 실어 저장해야 붙는다.
 *
 * 훅이 아니라 함수다. 여러 개를 차례로 올릴 때 `useMutation` 의 `mutate` 를 반복해 부르면
 * 앞선 호출의 콜백이 떨어진다(채팅 `uploadAttachment` 와 같은 이유).
 */
export function uploadPostAttachment(boardId: string, file: File): Promise<PostAttachment> {
  const form = new FormData()
  form.append('file', file)
  return api<PostAttachment>(`/boards/${boardId}/attachments`, { method: 'POST', body: form })
}

export function useCreatePost(boardId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: PostInput) =>
      api<BoardPostDetail>(`/boards/${boardId}/posts`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['boards', boardId, 'posts'] })
      // 홈 공지 카드도 같은 데이터를 본다.
      void qc.invalidateQueries({ queryKey: homeKeys.home })
    },
  })
}

/** 제목이 바뀌거나 글이 사라지면 같이 흔들리는 목록들. 홈 공지 카드도 같은 데이터를 본다. */
function invalidateLists(qc: ReturnType<typeof useQueryClient>, boardId: string) {
  void qc.invalidateQueries({ queryKey: ['boards', boardId, 'posts'] })
  void qc.invalidateQueries({ queryKey: homeKeys.home })
}

export function useUpdatePost(boardId: string, postId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: PostInput) =>
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

const commentsKey = (postId: string) => ['posts', postId, 'comments'] as const

/** 그 글의 댓글. 오래된 순. 글을 못 보는 사람은 댓글도 못 본다(403). */
export function usePostComments(postId: string) {
  return useQuery({
    queryKey: commentsKey(postId),
    queryFn: () => api<{ items: PostComment[] }>(`/posts/${postId}/comments`),
    enabled: Boolean(postId),
    retry: false,
  })
}

export function useAddPostComment(postId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: string) =>
      api<PostComment>(`/posts/${postId}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body }),
      }),
    // 다시 받기를 기다린다. 안 기다리면 입력칸이 비워진 뒤에야 새 줄이 뜬다.
    onSuccess: () => qc.invalidateQueries({ queryKey: commentsKey(postId) }),
  })
}

/**
 * 댓글 고치기와 지우기. 실패해도 목록을 다시 받는다(다른 탭에서 이미 지운 댓글이면 이 목록이
 * 옛것이다). 다 받을 때까지 기다린다. 줄이 옛 글로 잠깐 비치거나 버튼이 되살아나지 않게.
 */
export function useEditPostComment(postId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) =>
      api<PostComment>(`/posts/${postId}/comments/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ body }),
      }),
    onSettled: () => qc.invalidateQueries({ queryKey: commentsKey(postId) }),
  })
}

export function useDeletePostComment(postId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<void>(`/posts/${postId}/comments/${id}`, { method: 'DELETE' }),
    onSettled: () => qc.invalidateQueries({ queryKey: commentsKey(postId) }),
  })
}
