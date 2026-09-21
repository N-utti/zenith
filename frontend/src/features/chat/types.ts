/** 백엔드 `routers/channels.py` 의 `Person`. */
export interface Person {
  id: string
  name: string
}

/** 메시지에 붙은 파일. 소켓의 `msg` 에 그대로 실어 보낸다. */
export interface ChatAttachment {
  url: string
  name: string
  size: number
  /**
   * 업로드가 저장한 형식. **보낸 쪽 값이라 판정에 쓰지 않는다**(`attachments.ts`).
   * 2026-09-18 이전 메시지는 `null` 이라 `undefined` 만 분기하면 놓친다.
   */
  content_type?: string | null
}

/** 백엔드 `MessageOut`. 소켓이 밀어 주는 메시지도 같은 모양이다. */
export interface ChatMessage {
  id: string
  channel_id: string
  author: Person
  body: string
  /** 문서 카드. 아직 화면이 읽지 않는다. */
  doc_ref: string | null
  attachments: ChatAttachment[] | null
  created_at: string
}

/** 백엔드 `ChannelOut`. */
export interface ChatChannel {
  id: string
  /** DM은 보는 사람에 따라 이름이 다르다. 상대의 이름이 온다. */
  name: string
  is_dm: boolean
  members: Person[]
  unread: number
  last_message: ChatMessage | null
}

/**
 * 서버가 WebSocket 으로 밀어 주는 이벤트(04 §4.1). 봉투 키는 `ev` 이고 필드는 snake_case 다.
 *
 * `presence`(재실)·`notice`(알림)도 같은 소켓으로 오지만 여기에 없다. 받을 화면이 없어서다.
 * 재실은 근태 모듈이 판정하고(`components/layout/WorkStatus.tsx`), 알림함은 아직 소켓을 읽지
 * 않고 `GET /me/notifications` 만 본다. 그래서 둘은 받아서 버린다. 화면이 생기면 union 에 더한다.
 */
export type ChatEvent =
  | { ev: 'msg'; channel_id: string; message: ChatMessage }
  /** 내 안읽음 숫자. 새 메시지 때는 사람마다 자기 숫자, `read` 뒤에는 본인에게 0. */
  | { ev: 'unread'; channel_id: string; count: number }
  | { ev: 'typing'; channel_id: string; user_id: string; name: string }
  /**
   * 보낸 것이 거절됐다. 소켓은 닫히지 않는다.
   *
   * `detail` 은 문구 하나일 때도 있고 필드별 오류 배열일 때도 있다(프레임이 스키마에 안 맞으면
   * pydantic 오류가 그대로 온다). 사람에게 보일 문구는 `events.ts` 의 `errorText()` 가 고른다.
   */
  | { ev: 'error'; code: string; detail: unknown; channel_id?: string }
