import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { defaultFolderId } from './tree'
import type {
  DocComment,
  DocDetail,
  DocSummary,
  DocTreeData,
  DocVersion,
  Folder,
  UploadedFile,
} from './types'

export const docKeys = {
  tree: ['tree'] as const,
  list: (query: string) => ['documents', 'list', query] as const,
  detail: (docId: string) => ['documents', docId] as const,
  comments: (docId: string) => ['documents', docId, 'comments'] as const,
  versions: (docId: string) => ['documents', docId, 'versions'] as const,
  /** 홈이 limit 을 붙여 쓴다. 무효화가 limit 과 무관하게 걸리도록 여기까지만 키로 둔다. */
  recent: ['documents', 'recent'] as const,
}

/** 사이드바 트리. 폴더와 문서를 한 번에 받는다. */
export function useTree() {
  return useQuery({
    queryKey: docKeys.tree,
    queryFn: () => api<DocTreeData>('/tree'),
  })
}

/**
 * 새 문서를 넣을 기본 폴더. 문서는 폴더 안에만 생기는데, 홈·문서 목록·AI 답변 저장처럼
 * 폴더를 고를 자리가 없는 곳에서는 최상위 첫 폴더에 넣는다.
 *
 * 아직 안 온 것과 하나도 없는 것을 갈라서 준다. 둘을 뭉치면 트리를 받는 동안 "폴더를 먼저
 * 만들어 주세요" 라는 틀린 안내가 뜬다.
 */
export function useDefaultFolder(): {
  folderId: string | undefined
  folderName: string | undefined
  isPending: boolean
  isError: boolean
} {
  const { data, isPending, isError } = useTree()
  const folderId = data && defaultFolderId(data)
  return {
    folderId,
    folderName: data?.folders.find((f) => f.id === folderId)?.title,
    isPending,
    isError,
  }
}

export function useCreateFolder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { title: string; parent_id?: string | null }) =>
      api<Folder>('/folders', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: docKeys.tree }),
  })
}

export function useRenameFolder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      api<Folder>(`/folders/${id}`, { method: 'PATCH', body: JSON.stringify({ title }) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: docKeys.tree }),
  })
}

/**
 * 제목으로 거르는 목록. 04 에 `GET /docs` 가 없다. 본문 검색은 `GET /search` 가 따로 있고,
 * 이 훅은 문서 화면의 제목 필터라 그대로 둔다.
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

/** 빈 문서의 제목. 서버가 제목을 **요구하므로**(`DocCreateIn`) 안 보내면 422 다. */
export const UNTITLED_DOC = '제목 없는 문서'

/** 문서는 폴더 안에만 생긴다. 서버가 `folder_id` 와 `title` 을 둘 다 요구한다. */
export function useCreateDoc() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ folder_id, title = UNTITLED_DOC }: { folder_id: string; title?: string }) =>
      api<DocSummary>('/docs', { method: 'POST', body: JSON.stringify({ folder_id, title }) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['documents'] })
      void qc.invalidateQueries({ queryKey: docKeys.tree })
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
      void qc.invalidateQueries({ queryKey: docKeys.tree })
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
