import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '@/lib/api'
import { queryClient } from '@/lib/queryClient'
import { homeKeys } from '@/features/home/keys'
import { meQueryKey } from '@/features/auth/queries'
import { defaultFolderId } from './tree'
import type {
  DocComment,
  DocDetail,
  DocSummary,
  DocTreeData,
  DocVersion,
  DocVersionSnapshot,
  Folder,
  UploadedFile,
} from './types'

export const docKeys = {
  tree: ['tree'] as const,
  list: (query: string) => ['documents', 'list', query] as const,
  detail: (docId: string) => ['documents', docId] as const,
  comments: (docId: string) => ['documents', docId, 'comments'] as const,
  versions: (docId: string) => ['documents', docId, 'versions'] as const,
  /** 버전 하나의 스냅샷. 목록 키 아래에 두면 새 버전이 저장될 때마다 같이 버려진다. */
  snapshot: (docId: string, versionId: string) =>
    ['documents', docId, 'snapshot', versionId] as const,
  trash: ['trash'] as const,
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
    // 제목을 비우면 서버가 422 로 막는다(minLength 1). 빈 제목은 기본 문구로 보낸다.
    mutationFn: (title?: string) =>
      api<DocSummary>(`/docs/${docId}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: title === '' ? UNTITLED_DOC : title }),
      }),
    onSuccess: (doc) => {
      qc.setQueryData(docKeys.detail(docId), doc)
      void qc.invalidateQueries({ queryKey: ['documents', 'list'] })
      void qc.invalidateQueries({ queryKey: docKeys.tree })
      // 홈의 "이어서 작업" 도 같은 문서를 본다.
      void qc.invalidateQueries({ queryKey: homeKeys.home })
    },
  })
}

/**
 * 문서가 사라지거나 돌아오면 같이 흔들리는 **목록들**. 상세·댓글·버전은 건드리지 않는다.
 *
 * `['documents']` 로 한 번에 지우면 접두 일치라 모든 문서의 상세·댓글·버전까지 딸려 간다.
 * 바로 위에서 상세를 "다시 부르지 않는다" 고 해 둔 것도 그 한 줄이 도로 무효로 만든다.
 */
function invalidateDocLists(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ['documents', 'list'] })
  void qc.invalidateQueries({ queryKey: docKeys.tree })
  // 휴지통은 살아 있는 목록의 여집합이다. 한쪽이 바뀌면 다른 쪽도 바뀐다.
  void qc.invalidateQueries({ queryKey: docKeys.trash })
  void qc.invalidateQueries({ queryKey: ['search'] })
  // 홈의 "이어서 작업" 도 같은 문서를 본다.
  void qc.invalidateQueries({ queryKey: homeKeys.home })
}

/** 휴지통으로 보낸다. 30일 뒤 서버가 영구 삭제한다. 그 전에는 휴지통 화면에서 되돌릴 수 있다. */
export function useTrashDoc(docId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api<void>(`/docs/${docId}`, { method: 'DELETE' }),
    onSuccess: () => {
      /*
       * 상세 캐시에 휴지통 표시를 직접 찍는다. 다시 부르게 두면 아직 이 화면이 그 쿼리를 보고
       * 있어서 요청이 한 번 더 나가고, 아무것도 안 하면 `staleTime` 동안 살아 있는 문서로
       * 남아 같은 주소를 다시 열었을 때 편집기가 뜬다.
       *
       * 시각은 서버 값이 아니다(DELETE 는 204 라 본문이 없다). 다음 조회에서 서버 값으로
       * 덮인다. 영구 삭제 예정일 계산에만 쓰이므로 이 정도 오차는 화면에 안 보인다.
       */
      qc.setQueryData(docKeys.detail(docId), (prev: DocDetail | undefined) =>
        prev ? { ...prev, deleted_at: new Date().toISOString() } : undefined,
      )
      void qc.invalidateQueries({ queryKey: docKeys.detail(docId), refetchType: 'none' })
      invalidateDocLists(qc)
    },
  })
}

/**
 * 휴지통에서 되돌린다. 훅이 아니라 그냥 함수다.
 *
 * 되돌리기를 누르는 자리가 **문서를 떠난 뒤의 토스트**이기 때문이다. 훅으로 만들면 그 요청을
 * 건 화면이 이미 없어서 `mutate` 에 넘긴 성공·실패 콜백이 불리지 않는다(관찰자에 리스너가
 * 없다). 캐시는 갱신되는데 사용자에게는 아무 표시가 없고, 실패해도 조용하다.
 */
export async function untrashDoc(docId: string): Promise<DocSummary> {
  const doc = await api<DocSummary>(`/docs/${docId}/untrash`, { method: 'POST' }).catch(
    (err: unknown) => {
      /*
       * 훅 밖이라 `lib/queryClient.ts` 의 401 처리가 안 탄다. 그 처리는 쿼리·뮤테이션 캐시의
       * 오류 훅에 걸려 있는데 이 호출은 둘 다 아니다. 그대로 두면 되돌리기를 누르는 사이에
       * 세션이 끊겼을 때 "되돌리지 못했습니다" 만 뜨고 로그인 화면으로 못 간다.
       */
      if (err instanceof ApiError && err.status === 401) queryClient.setQueryData(meQueryKey, null)
      throw err
    },
  )
  queryClient.setQueryData(docKeys.detail(doc.id), (prev: DocDetail | undefined) =>
    prev ? { ...prev, ...doc } : undefined,
  )
  void queryClient.invalidateQueries({ queryKey: docKeys.detail(doc.id), refetchType: 'none' })
  invalidateDocLists(queryClient)
  return doc
}

export function useVersions(docId: string) {
  return useQuery({
    queryKey: docKeys.versions(docId),
    queryFn: () => api<{ items: DocVersion[] }>(`/docs/${docId}/versions`),
  })
}

/**
 * 그 버전의 스냅샷을 받는다. 목록에는 없다(`DocVersion` 주석).
 *
 * 이름이 `restore` 지만 서버는 아무것도 되돌리지 않는다. 서버가 Y.Doc 을 과거 상태로
 * 갈아끼우면 접속 중인 다른 사람과 병합돼 도로 취소된다. 되돌리기는 클라이언트가
 * '앞으로 가는 편집' 한 번으로 한다(`DocWorkspace` 의 `restore`).
 */
export function useVersionSnapshot(docId: string) {
  const qc = useQueryClient()
  return useMutation({
    // 캐시를 거친다. 스냅샷은 그 시점의 표식이라 바뀌지 않으므로, 버전을 오가며 미리보기를
    // 열 때마다 같은 것을 다시 받을 이유가 없다. 같이 눌린 요청도 하나로 합쳐진다.
    mutationFn: (versionId: string) =>
      qc.fetchQuery({
        queryKey: docKeys.snapshot(docId, versionId),
        queryFn: () =>
          api<DocVersionSnapshot>(`/docs/${docId}/restore`, {
            method: 'POST',
            body: JSON.stringify({ version_id: versionId }),
          }),
        staleTime: Infinity,
      }),
  })
}

export function useSaveVersion(docId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { snapshot: string; label?: string }) =>
      api<DocVersionSnapshot>(`/docs/${docId}/versions`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      // 응답에 스냅샷이 실려 오지만 목록 캐시에 넣지 않는다. `DocVersionSnapshot` 은
      // `DocVersion` 의 하위 타입이라 `setQueryData` 가 타입 검사를 통과하면서 목록에 스냅샷을
      // 도로 섞어 넣는다. 이 커밋이 없애려던 상태가 캐시 안에서 되살아난다.
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

/** 휴지통 목록. 지운 지 최근 순으로 서버가 정렬해 준다. */
export function useTrash() {
  return useQuery({
    queryKey: docKeys.trash,
    queryFn: () => api<{ items: DocSummary[] }>('/trash'),
  })
}

/**
 * 휴지통에서 되돌리기. 위의 `untrashDoc` 을 훅으로 감싼 것이다.
 *
 * 토스트에서 부르는 쪽은 화면이 이미 사라진 뒤라 훅을 쓸 수 없었다. 휴지통 화면은 요청을 건
 * 자리가 그대로 있으므로, 줄마다 진행 상태를 보이려고 훅으로 쓴다. 캐시 갱신은 함수가 한다.
 */
export function useUntrashDoc() {
  return useMutation({ mutationFn: untrashDoc })
}

/**
 * 영구 삭제(`?hard=1`). 임원만 할 수 있고 버전·댓글·색인까지 같이 지운다. 되돌릴 수 없다.
 *
 * 30일을 기다리지 않고 지금 지우는 길이다. 등급이 모자라면 서버가 403 을 주고 감사 기록에
 * 거부가 남는다.
 */
export function usePurgeDoc() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (docId: string) => api<void>(`/docs/${docId}?hard=1`, { method: 'DELETE' }),
    onSuccess: (_data, docId) => {
      qc.removeQueries({ queryKey: docKeys.detail(docId) })
      invalidateDocLists(qc)
    },
  })
}
