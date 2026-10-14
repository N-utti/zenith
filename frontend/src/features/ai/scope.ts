import { ApiError } from '@/lib/api'
import type { DocTreeData, Folder } from '@/features/docs/types'

/** 드롭다운의 "전체" 값. 서버에는 보내지 않는다(`scope: null`). 폴더 id 는 UUID 라 겹치지 않는다. */
export const SCOPE_ALL = 'all'

/**
 * 지식 소스로 고를 수 있는 폴더: 사이드바 트리(`GET /tree`)의 최상위 폴더(백엔드 #372).
 * 고르면 그 아래 모든 깊이의 문서만 근거가 되고 게시글은 빠진다.
 */
export function topFolders(tree: DocTreeData | undefined): Folder[] {
  return tree?.folders.filter((folder) => folder.parent_id === null) ?? []
}

/**
 * 서버가 범위의 폴더를 없다고 거절했는가(지워졌거나 권한 밖. 서버는 둘을 구분해 주지 않는다).
 * 문서 범위(`doc:<id>`)의 거절(없음·휴지통·근거 꺼짐)도 같은 모양이라 함께 걸린다.
 * 스키마 검증 실패(질문이 너무 김 등)도 같은 422 `VALIDATION` 이라 코드로는 못 가른다.
 * 그쪽은 사유(`detail`)가 배열이고 폴더 거절만 문자열이다.
 */
export function rejected(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 422 &&
    typeof (error.body as { detail?: unknown } | null)?.detail === 'string'
  )
}
