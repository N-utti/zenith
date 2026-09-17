import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { DocComment, DocDetail, DocSummary, DocVersion, UploadedFile } from './types'

export const docKeys = {
  list: (query: string) => ['documents', 'list', query] as const,
  detail: (docId: string) => ['documents', docId] as const,
  comments: (docId: string) => ['documents', docId, 'comments'] as const,
  versions: (docId: string) => ['documents', docId, 'versions'] as const,
  /** 홈이 limit 을 붙여 쓴다. 무효화가 limit 과 무관하게 걸리도록 여기까지만 키로 둔다. */
  recent: ['documents', 'recent'] as const,
}

/**
 * 목록·검색은 04 에 `GET /docs` 가 없다. 백엔드는 사이드바 트리를 `GET /tree`,
 * 본문 검색을 `GET /search` 로 나눠 준다. 둘을 붙일 때 이 훅이 그쪽으로 옮겨 간다.
 */
export function useDocs(query: string) {
  return useQuery({
    queryKey: docKeys.list(query),
    queryFn: () => api<{ items: DocSummary[] }>(`/docs?q=${encodeURIComponent(query)}`),
  })
}

export function useDoc(docId: string) {
  return useQuery({
    queryKey: docKeys.detail(docId),
    queryFn: () => api<DocDetail>(`/docs/${docId}`),
  })
}

export function useCreateDoc() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api<DocSummary>('/docs', { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['documents'] })
    },
  })
}

/**
 * 제목·수정시각을 서버에 투영한다. 본문과 제목의 원천은 Y.Doc이고,
 * 이 호출은 목록·검색이 볼 사본을 갱신하는 용도다.
 */
export function useTouchDoc(docId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (title?: string) =>
      api<DocSummary>(`/docs/${docId}`, {
        method: 'PATCH',
        body: JSON.stringify({ title }),
      }),
    onSuccess: (doc) => {
      qc.setQueryData(docKeys.detail(docId), doc)
      void qc.invalidateQueries({ queryKey: ['documents', 'list'] })
      void qc.invalidateQueries({ queryKey: docKeys.recent })
    },
  })
}

export function useVersions(docId: string) {
  return useQuery({
    queryKey: docKeys.versions(docId),
    queryFn: () => api<{ items: DocVersion[] }>(`/docs/${docId}/versions`),
  })
}

export function useSaveVersion(docId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { snapshot: string; label?: string }) =>
      api<DocVersion>(`/docs/${docId}/versions`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: docKeys.versions(docId) })
    },
  })
}

/**
 * 파일을 올리고 접근 URL을 받는다. 캐시할 것이 없어 react-query를 거치지 않는다.
 * 본문(Y.Doc)에는 바이너리가 아니라 여기서 받은 url만 들어간다.
 */
export function uploadFile(file: File) {
  const form = new FormData()
  form.append('file', file)
  return api<UploadedFile>('/files', { method: 'POST', body: form })
}

export function useComments(docId: string) {
  return useQuery({
    queryKey: docKeys.comments(docId),
    queryFn: () => api<{ items: DocComment[] }>(`/docs/${docId}/comments`),
  })
}

export function useAddComment(docId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: string) =>
      api<DocComment>(`/docs/${docId}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: docKeys.comments(docId) })
    },
  })
}
