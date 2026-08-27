export interface ChatChannel {
  id: string
  kind: 'channel' | 'dm'
  /** DM은 보는 사람에 따라 이름이 다르다 — 상대의 이름이 온다. */
  name: string
  memberIds: string[]
  unread: number
  lastMessage: string | null
  lastAt: string | null
}

export interface ChatMessage {
  id: string
  channelId: string
  authorId: string
  authorName: string
  authorHue: number
  body: string
  createdAt: string
}

/** 서버가 WebSocket으로 밀어 주는 이벤트. */
export type ChatEvent =
  | { type: 'message'; message: ChatMessage }
  | { type: 'typing'; channelId: string; userId: string; name: string }
  | { type: 'read'; channelId: string; userId: string }
