import type { ChatChannel, ChatMessage } from './types'

/**
 * 소켓 이벤트를 캐시에 반영하는 순수 변환들. 훅에서 떼어 둔 이유는 테스트 때문이다 —
 * 봉투 규약(04 §4.1)이 바뀌면 여기가 먼저 깨져야 한다.
 */

/**
 * `msg` 로 받은 메시지를 메시지 목록에 붙인다.
 *
 * 탭이 여러 개면 같은 이벤트를 중복으로 받는다. id 로 한 번 걸러야 같은 메시지가 두 줄이 된다.
 * 목록을 아직 안 받은 채널이면(`undefined`) 아무것도 하지 않는다. 열 때 GET 으로 받는다.
 */
export function appendMessage(
  page: { items: ChatMessage[] } | undefined,
  message: ChatMessage,
): { items: ChatMessage[] } | undefined {
  if (!page) return page
  if (page.items.some((item) => item.id === message.id)) return page
  return { items: [...page.items, message] }
}

/**
 * `unread` 로 받은 숫자를 채널 목록에 꽂는다. 서버가 보는 사람마다 자기 숫자를 보내므로
 * (`realtime/chat.py` `_unread_counts`) 목록을 다시 받을 필요가 없다.
 *
 * 모르는 채널 id 면 그대로 둔다. 방금 만들어져 아직 목록에 없는 채널일 수 있고, 그건 채널
 * 목록 재조회가 가져온다.
 */
export function withUnread(
  list: { items: ChatChannel[] } | undefined,
  channelId: string,
  count: number,
): { items: ChatChannel[] } | undefined {
  if (!list) return list
  return {
    items: list.items.map((item) => (item.id === channelId ? { ...item, unread: count } : item)),
  }
}

/**
 * `error` 이벤트에서 사람이 읽을 문구만 뽑는다.
 *
 * `detail` 은 문구 하나일 때도 있고 필드별 오류 배열일 때도 있다. 프레임이 스키마에 안 맞으면
 * pydantic 오류가 배열로 그대로 오는데, 그건 사용자에게 뜻이 없어 일반 문구로 바꾼다.
 */
export function errorText(event: { code: string; detail: unknown }): string {
  if (typeof event.detail === 'string' && event.detail.trim()) return event.detail
  if (event.code === 'FORBIDDEN') return '이 대화에 글을 쓸 수 없습니다.'
  return '메시지를 보내지 못했습니다.'
}
