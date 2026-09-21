import type { ChatChannel, ChatMessage } from './types'

/**
 * 소켓 이벤트를 캐시에 반영하는 순수 변환들. 훅에서 떼어 둔 이유는 테스트 때문이다.
 *
 * 다만 이 테스트가 지키는 것은 변환의 경계 조건(중복 id, 모르는 채널, 순서가 뒤집힌 도착)
 * 이지 **봉투 규약 자체가 아니다.** 서버가 `ev` 나 `channel_id` 같은 키 이름을 바꾸면 이
 * 테스트는 전부 초록불인 채로 화면이 죽는다. #128 이 정확히 그 종류였다. 봉투를 지키는 것은
 * `types.ts` 의 ChatEvent 와 실서버 확인뿐이니, 규약을 건드릴 때는 실서버로 붙여서 봐야 한다.
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
 * `msg` 로 받은 메시지를 채널 목록의 「마지막 메시지」로 꽂는다.
 *
 * 전에는 목록을 다시 받아서 갱신했는데, 그 재조회가 뒤따라오는 `unread` patch 를 덮어
 * 읽고 있는 채널에 배지가 남는 일이 있었다. 목록에 쓰는 주체를 소켓 하나로 줄인다.
 *
 * 더 최신일 때만 바꾼다. 이벤트는 순서대로 오지만, 두 탭이 붙었다 끊기는 사이에 늦게 도착한
 * 옛 메시지가 마지막 줄을 과거로 되돌리면 목록이 거짓이 된다.
 */
export function withLastMessage(
  list: { items: ChatChannel[] } | undefined,
  message: ChatMessage,
): { items: ChatChannel[] } | undefined {
  if (!list) return list
  return {
    items: list.items.map((item) => {
      if (item.id !== message.channel_id) return item
      const last = item.last_message
      if (last && last.created_at > message.created_at) return item
      return { ...item, last_message: message }
    }),
  }
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
 *
 * 어느 op 이 거절됐는지는 이벤트에 없다. 보내기만이 아니라 읽음·타이핑도 같은 모양으로
 * 거절되므로(`realtime/chat.py` 는 op 종류를 가리기 전에 멤버십부터 본다) 문구가 "보내기"를
 * 단정하면 안 된다. 아무것도 안 썼는데 발송 실패라고 뜨는 일이 생긴다.
 */
export function errorText(event: { code: string; detail: unknown }): string {
  if (typeof event.detail === 'string' && event.detail.trim()) return event.detail
  if (event.code === 'FORBIDDEN') return '이 대화를 볼 권한이 없습니다.'
  return '채팅 서버가 요청을 거절했습니다.'
}
