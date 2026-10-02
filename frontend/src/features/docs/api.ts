import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '@/lib/api'
import { queryClient } from '@/lib/queryClient'
import { homeKeys } from '@/features/home/keys'
import { meQueryKey } from '@/features/auth/queries'
import type { TreeItem } from './tree'
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
 * 문서·폴더를 다른 폴더로 옮긴다. `to` 가 null 이면 최상위인데 폴더만 된다(문서는 422).
 *
 * 서버는 문서 이동도 수정으로 친다. 수정 시각이 지금이 되어 "이어서 작업" 맨 위로 온다.
 */
export function useMoveNode() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ item, to }: { item: TreeItem; to: string | null }) =>
      api<DocSummary | Folder>(item.kind === 'doc' ? `/docs/${item.id}` : `/folders/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify(item.kind === 'doc' ? { folder_id: to } : { parent_id: to }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: docKeys.tree })
      void qc.invalidateQueries({ queryKey: homeKeys.home })
      // 검색 결과는 문서가 든 폴더 이름을 같이 보여 준다.
      void qc.invalidateQueries({ queryKey: ['search'] })
    },
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
 *
 * `doc_id` 는 어느 문서에서 올렸는지다. 자료실이 출처로 쓴다. 없는 문서나 휴지통에 든 문서면
 * 서버가 422 로 거절한다.
 */
export function uploadFile(file: File, docId: string) {
  const form = new FormData()
  form.append('file', file)
  form.append('doc_id', docId)
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
    // `block_id` 가 없으면 문서 전체에 다는 댓글이다.
    mutationFn: (input: { body: string; block_id?: string }) =>
      api<DocComment>(`/docs/${docId}/comments`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: docKeys.comments(docId) })
    },
  })
}

export function useDeleteComment(docId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (commentId: string) =>
      api<void>(`/docs/${docId}/comments/${commentId}`, { method: 'DELETE' }),
    // 실패해도 다시 받는다. 다른 탭에서 이미 지운 댓글(404)이면 이 목록이 옛것이다.
    // 다시 받기를 기다린다. 안 기다리면 줄이 사라지기 전에 버튼이 되살아나 한 번 더 눌린다.
    onSettled: () => qc.invalidateQueries({ queryKey: docKeys.comments(docId) }),
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
