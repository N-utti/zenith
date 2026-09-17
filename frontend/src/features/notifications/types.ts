/**
 * 알림 한 건. 백엔드 `routers/me.py` 의 `NotificationOut` 과 같은 모양이라 필드가 snake_case 다.
 *
 * `payload` 는 종류마다 다른 자유 형식이고, 서버가 만든 시점의 값이다. 그래서 화면은
 * `payload` 를 **믿고 그리되 권한은 묻지 않는다**. 권한 판정은 서버가 응답을 만들 때 다시 한다
 * (등급이 내려간 뒤에도 옛 제목이 읽히면 안 되므로 `kind=post` 는 그때 제목을 가린다).
 */
export interface Notification {
  id: string
  kind: string
  payload: NotificationPayload | null
  read_at: string | null
  created_at: string
}

/** 보낸 사람. 모든 종류의 payload 에 같은 이름으로 들어간다. */
export interface NotificationActor {
  id: string
  name: string
}

/**
 * 지금 서버가 만드는 두 종류의 payload 를 합친 것. 종류가 늘면(`att_*`·`apv_*`) 여기에 더한다.
 * 어느 필드가 있느냐로 갈라지므로 전부 선택 항목이다.
 */
export interface NotificationPayload {
  from?: NotificationActor
  /** 멘션 공통. 본문 앞 120자. */
  preview?: string
  /** 문서 댓글 멘션 (`routers/docs.py`). */
  doc_id?: string
  doc_title?: string
  comment_id?: string
  block_id?: string | null
  /** 채팅 멘션 (`realtime/chat.py`). */
  channel_id?: string
  message_id?: string
  /** 새 글 (`routers/boards.py`). */
  post_id?: string
  board_id?: string
  board_name?: string
  title?: string
  /** 권한 밖 글이라 제목이 가려진 알림. 서버가 응답을 만들 때 붙인다. */
  masked?: boolean
}

/** 알림함 탭. 백엔드는 `?unread=1` 로 받는다. */
export type NotificationFilter = 'all' | 'unread'
