import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { DocComment, DocDetail, DocSummary, DocVersion } from './types'

export const docKeys = {
  list: (query: string) => ['documents', 'list', query] as const,
  detail: (docId: string) => ['documents', docId] as const,
  comments: (docId: string) => ['documents', docId, 'comments'] as const,
  versions: (docId: string) => ['documents', docId, 'versions'] as const,
  recent: ['documents', 'recent', { limit: 5 }] as const,
}

export function useDocs(query: string) {
  return useQuery({
    queryKey: docKeys.list(query),
    queryFn: () => api<{ items: DocSummary[] }>(`/documents?q=${encodeURIComponent(query)}`),
  })
}

export function useDoc(docId: string) {
  return useQuery({
    queryKey: docKeys.detail(docId),
    queryFn: () => api<DocDetail>(`/documents/${docId}`),
  })
}

export function useCreateDoc() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api<DocSummary>('/documents', { method: 'POST' }),
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
      api<DocSummary>(`/documents/${docId}`, {
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
    queryFn: () => api<{ items: DocVersion[] }>(`/documents/${docId}/versions`),
  })
}

export function useSaveVersion(docId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { snapshot: string; label?: string }) =>
      api<DocVersion>(`/documents/${docId}/versions`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: docKeys.versions(docId) })
    },
  })
}

export function useComments(docId: string) {
  return useQuery({
    queryKey: docKeys.comments(docId),
    queryFn: () => api<{ items: DocComment[] }>(`/documents/${docId}/comments`),
  })
}

export function useAddComment(docId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: string) =>
      api<DocComment>(`/documents/${docId}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: docKeys.comments(docId) })
    },
  })
}
