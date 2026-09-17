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

/** 서버가 WebSocket으로 밀어 주는 이벤트. */
export type ChatEvent =
  | { type: 'message'; message: ChatMessage }
  | { type: 'typing'; channelId: string; userId: string; name: string }
  | { type: 'read'; channelId: string; userId: string }
