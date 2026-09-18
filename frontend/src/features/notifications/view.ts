import type { Notification, NotificationPayload } from './types'

/**
 * 멘션으로 보는 종류. 백엔드 `routers/me.py` 의 `MENTION_KINDS` 와 같다.
 *
 * 허용 목록이어야 한다. "글 알림만 빼고 전부 멘션" 으로 두면 근태·결재 알림(`att_*`·`apv_*`)이
 * 붙는 순간 그것들이 전부 멘션 분기로 흘러들어, 문서 id 도 채널 id 도 없는 채로 빈 링크를 만든다.
 */
const MENTION_KINDS = ['mention', 'comment', 'reply']

/**
 * 알림 한 건을 화면이 그릴 수 있는 모양으로 바꾼다.
 *
 * `payload` 는 종류마다 다른 자유 형식이라, 멘션 안에서는 어느 필드가 있느냐로 갈라진다.
 * 종류 이름만으로 갈라지지 않는 이유는 멘션 하나가 문서 댓글일 수도 채팅일 수도 있기 때문이다.
 *
 * `to` 가 `null` 이면 누를 수 없는 알림이다. 권한 밖이라 제목이 가려진 글 알림이 그렇다.
 */
export interface NotificationView {
  /** 아바타 색을 만드는 데 쓴다. 보낸 사람을 모르면 빈 문자열. */
  actorId: string
  actorName: string
  /** 한 줄 요약. "누가 어디에서 무엇을" */
  summary: string
  /** 그 아래 회색 줄. 원문 미리보기나 게시판 이름. */
  detail: string | null
  to: string | null
  /** 아이콘 자리. 화면이 이 값으로 고른다. */
  icon: 'doc' | 'chat' | 'board' | 'locked'
  /** 권한 밖이라 가려진 알림. 화면이 이유를 밝히고 아바타를 그리지 않는다. */
  masked: boolean
}

const UNKNOWN = '알 수 없음'

function mentionView(p: NotificationPayload): NotificationView | null {
  const actorId = p.from?.id ?? ''
  const actorName = p.from?.name ?? UNKNOWN

  if (p.doc_id) {
    return {
      actorId,
      actorName,
      // 어느 문서인지 요약에 넣는다. 누르기 전에 알 수 있어야 한다.
      summary: p.doc_title
        ? `${actorName}님이 «${p.doc_title}»에서 회원님을 불렀습니다`
        : `${actorName}님이 문서에서 회원님을 불렀습니다`,
      detail: p.preview ?? null,
      to: `/docs/${p.doc_id}`,
      icon: 'doc',
      masked: false,
    }
  }
  if (p.channel_id) {
    return {
      actorId,
      actorName,
      /*
       * DM 이면 `channel_name` 이 보낸 사람 이름이라(`realtime/chat.py`) 「홍길동님이 «홍길동»에서」
       * 가 된다. 같으면 채널 이름을 빼서 DM 을 가려낸다 — payload 에 DM 표시가 따로 없다.
       */
      summary:
        p.channel_name && p.channel_name !== actorName
          ? `${actorName}님이 «${p.channel_name}»에서 회원님을 불렀습니다`
          : `${actorName}님이 채팅에서 회원님을 불렀습니다`,
      detail: p.preview ?? null,
      to: `/chat/${p.channel_id}`,
      icon: 'chat',
      masked: false,
    }
  }
  return null
}

function postView(p: NotificationPayload): NotificationView | null {
  if (!p.post_id || !p.board_id) return null
  const actorName = p.from?.name ?? UNKNOWN

  /*
   * 가려진 글이면 글쓴이를 지운다. 백엔드 마스킹(`_mask_post_notices`)도 2026-09-18 부터
   * `from` 을 `null` 로 지우지만(홈 공지 목록 `_posts` 와 같은 기준), 그전에 쌓인 알림 행은
   * 작성자를 그대로 싣고 있다. 여기서 한 번 더 지운다.
   */
  if (p.masked) {
    return {
      actorId: '',
      actorName: UNKNOWN,
      summary: p.title ?? UNKNOWN,
      detail: p.board_name ?? null,
      to: null,
      icon: 'locked',
      masked: true,
    }
  }

  return {
    actorId: p.from?.id ?? '',
    actorName,
    summary: p.title ?? UNKNOWN,
    detail: p.board_name ? `${p.board_name} · ${actorName}` : actorName,
    to: `/board/${p.board_id}/${p.post_id}`,
    icon: 'board',
    masked: false,
  }
}

/** 모르는 종류는 `null` 이다. 화면은 그 줄을 건너뛴다. 새 종류가 붙어도 목록이 깨지지 않는다. */
export function notificationView(notification: Notification): NotificationView | null {
  const p = notification.payload
  if (!p) return null
  if (notification.kind === 'post') return postView(p)
  if (MENTION_KINDS.includes(notification.kind)) return mentionView(p)
  return null
}
