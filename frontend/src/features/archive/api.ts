import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { uploadedFilePath } from '@/lib/links'
import { ARCHIVE_LIMIT, type ArchiveFile } from './types'

/** 자료실 목록. 올린 지 최근 순으로 서버가 정렬해 준다. */
export function useArchive() {
  return useQuery({
    queryKey: ['archive'],
    queryFn: () => api<{ items: ArchiveFile[] }>(`/archive?limit=${ARCHIVE_LIMIT}`),
    // 방금 붙인 파일이 바로 보여야 한다. 파일을 올리는 자리(채팅·문서)는 이 목록을 무효화하지 않는다.
    staleTime: 0,
  })
}

/** 채널 첨부의 주소. 마지막 조각(파일 이름)에는 경로를 바꾸는 글자를 받지 않는다. */
const CHAT_FILE = /^\/api\/channels\/[\w-]+\/attachments\/[\w-]+\/([^/\\?#]+)$/

/**
 * 내려받아도 되는 주소면 그대로, 아니면 `null`. 문서 파일과 채널 첨부, 두 모양만 통과한다.
 *
 * 주소는 메시지에 실려 온 값이다. `/api/` 로 시작하는지만 보면 `..` 로 다른 경로를 가리키는
 * 주소가 통과해, 줄에 적힌 자리(「전체」)와 실제로 받는 자리가 달라진다.
 */
export function downloadPath(url: string): string | null {
  if (uploadedFilePath(url)) return url
  const name = CHAT_FILE.exec(url)?.[1]
  // 점만으로 된 이름은 브라우저가 상위 경로로 푼다. `%2e` 로 적어도 같다.
  return name && !/^(\.|%2e){1,2}$/i.test(name) ? url : null
}
