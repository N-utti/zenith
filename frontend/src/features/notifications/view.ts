import type { Notification, NotificationPayload } from './types'

/**
 * 알림 한 건을 화면이 그릴 수 있는 모양으로 바꾼다.
 *
 * `payload` 는 종류마다 다른 자유 형식이라, 어느 필드가 있느냐로 갈라진다. 종류 이름(`kind`)만
 * 보고 갈라지지 않는 이유는 멘션(`kind=mention`)이 문서 댓글일 수도 채팅일 수도 있기 때문이다.
 *
 * `to` 가 `null` 이면 누를 수 없는 알림이다. 권한 밖이라 제목이 가려진 글 알림이 그렇다.
 */
export interface NotificationView {
  actorName: string
  /** 한 줄 요약. "누가 어디에서 무엇을" */
  summary: string
  /** 그 아래 회색 줄. 원문 미리보기나 게시판 이름. */
  detail: string | null
  to: string | null
  /** 아이콘 자리. 화면이 이 값으로 고른다. */
  icon: 'doc' | 'chat' | 'board'
}

const UNKNOWN = '알 수 없음'

function mentionView(p: NotificationPayload): NotificationView | null {
  const actorName = p.from?.name ?? UNKNOWN

  if (p.doc_id) {
    return {
      actorName,
      summary: `${actorName}님이 문서에서 회원님을 불렀습니다`,
      detail: p.preview ?? p.doc_title ?? null,
      to: `/docs/${p.doc_id}`,
      icon: 'doc',
    }
  }
  if (p.channel_id) {
    return {
      actorName,
      summary: `${actorName}님이 채팅에서 회원님을 불렀습니다`,
      detail: p.preview ?? null,
      to: `/chat/${p.channel_id}`,
      icon: 'chat',
    }
  }
  return null
}

function postView(p: NotificationPayload): NotificationView | null {
  if (!p.post_id || !p.board_id) return null
  const actorName = p.from?.name ?? UNKNOWN
  return {
    actorName,
    summary: p.title ?? UNKNOWN,
    detail: p.board_name ? `${p.board_name} · ${actorName}` : actorName,
    // 권한 밖이라 제목이 가려진 글은 열 수 없다. 눌러서 403 을 만나게 두지 않는다.
    to: p.masked ? null : `/board/${p.board_id}/${p.post_id}`,
    icon: 'board',
  }
}

/** 모르는 종류는 `null` 이다. 화면은 그 줄을 건너뛴다. 새 종류가 붙어도 목록이 깨지지 않는다. */
export function notificationView(notification: Notification): NotificationView | null {
  const p = notification.payload
  if (!p) return null
  if (notification.kind === 'post') return postView(p)
  // mention·comment·reply 는 payload 모양이 같다.
  return mentionView(p)
}
