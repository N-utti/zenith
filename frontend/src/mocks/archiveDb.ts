import type { ArchiveFile } from '@/features/archive/types'
import type { ChatChannel, ChatMessage } from '@/features/chat/types'
import type { StoredFile } from './filesDb'

/**
 * 자료실(`GET /archive`)의 목. 파일을 따로 쌓아 두지 않고 원래 자리에서 모은다.
 *
 * 채팅 첨부는 개발 릴레이의 메시지에, 문서 파일은 목 저장소(`filesDb`)에 있다. 여기는 그 둘을
 * 자료실 한 줄로 바꾸는 일만 한다. 받아 오는 일은 `handlers.ts` 가 한다.
 */

/**
 * 채널 하나의 메시지에서 첨부를 꺼낸다. 올린 사람과 시각은 그 메시지의 것이다.
 *
 * 채널 목록은 릴레이가 **내가 멤버인 것만** 준다. 그래서 여기 들어온 채널의 파일은 전부 내가
 * 받을 수 있는 것이고, 남의 비공개 채널 파일은 애초에 오지 않는다.
 */
export function chatFiles(
  channel: Pick<ChatChannel, 'id' | 'name' | 'is_dm' | 'is_private'>,
  messages: Pick<ChatMessage, 'author' | 'attachments' | 'created_at'>[],
): ArchiveFile[] {
  return messages.flatMap((message) =>
    (message.attachments ?? []).map((file) => ({
      url: file.url,
      name: file.name,
      size: file.size,
      source: 'chat' as const,
      source_id: channel.id,
      source_title: channel.name,
      uploaded_by: message.author,
      created_at: message.created_at,
      // 공개 채널은 전원이 멤버다. 비공개 채널과 DM 만 멤버로 좁혀진다.
      scope: channel.is_dm || channel.is_private ? ('members' as const) : ('all' as const),
    })),
  )
}

/**
 * 문서에 올린 파일. 문서에는 열람 등급이 없어 전원이 본다.
 *
 * 결재 첨부(`a-`)는 싣지 않는다. 결재 문서의 열람 판정을 따로 타는 파일이라 여기서 주소를
 * 내주면 그 판정을 건너뛴다. 올린 기록(시각·문서·사람)이 없는 예전 파일도 뺀다.
 *
 * `titleOf` 는 **살아 있는 문서**의 제목만 준다. 휴지통에 들었거나 영구 삭제된 문서의 파일은
 * 싣지 않는다. 지운 문서의 파일이 이름과 함께 전원에게 나열되면 안 된다.
 *
 * 본문에서 칩만 지운 파일도 싣는다. 실서버도 올린 적 있는 파일을 전부 싣는다(본문은 Y.Doc 에
 * 있어 어느 쪽도 지금 붙어 있는지 모른다).
 */
export function docFiles(
  stored: StoredFile[],
  titleOf: (docId: string) => string | undefined,
): ArchiveFile[] {
  return stored.flatMap((file) => {
    // 올린 기록 셋(시각·문서·사람)은 같이 저장된다. 하나라도 없으면 기록이 없는 예전 파일이다.
    if (!file.id.startsWith('f-') || !file.created_at || !file.doc_id || !file.uploaded_by) {
      return []
    }
    const title = titleOf(file.doc_id)
    if (title === undefined) return []
    return [
      {
        url: `/api/files/${file.id}`,
        name: file.name,
        size: file.size,
        source: 'doc' as const,
        source_id: file.doc_id,
        source_title: title,
        uploaded_by: { ...file.uploaded_by, is_bot: false },
        created_at: file.created_at,
        scope: 'all' as const,
      },
    ]
  })
}

/** 올린 지 최근 순으로 `limit` 개. */
export function newestFirst(files: ArchiveFile[], limit: number): ArchiveFile[] {
  return [...files].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit)
}
