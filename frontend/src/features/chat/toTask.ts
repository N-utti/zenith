import { TASK_NOTE_MAX, TASK_TITLE_MAX } from '@/features/projects/types'
import { formatDateTime } from '@/lib/datetime'
import type { ChatMessage } from './types'

/**
 * 메시지로 만드는 새 업무의 제목·메모 초안. 제목은 글의 첫 줄(글 없이 파일만 보냈으면 첫 파일 이름),
 * 메모는 누가 언제 한 말인지와 글 전체. 등록 전에 업무 창에서 고친다.
 */
// ponytail: 원래 메시지로 돌아가는 링크는 없다. 업무에 메시지 id 를 담을 칸이 서버에 생기면 붙인다.
export function taskDraftFrom(message: ChatMessage): { title: string; note: string } {
  const body = message.body.trim()
  const title = body.split('\n')[0].trim() || (message.attachments?.[0]?.name ?? '')
  const note = `${message.author.name} · ${formatDateTime(message.created_at)}\n${body}`.trim()
  return { title: title.slice(0, TASK_TITLE_MAX), note: note.slice(0, TASK_NOTE_MAX) }
}
