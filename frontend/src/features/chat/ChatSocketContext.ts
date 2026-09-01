import { createContext, use } from 'react'
import type { ChatSocket } from './useChatSocket'

/**
 * 채팅 소켓은 로그인 구역 전체에서 **하나만** 연결한다.
 *
 * 전에는 ChatPage가 직접 연결했다. 그래서 홈이나 문서 화면에 있으면 소켓이
 * 아예 없었고, 메시지가 와도 미읽음 배지가 그대로였다. 알림은 더더욱 불가능했다.
 * 지금은 ChatSocketProvider가 라우트 트리 위쪽에서 붙잡고 있어 화면을 옮겨도
 * 연결이 끊기지 않는다.
 */
export const ChatSocketContext = createContext<ChatSocket | null>(null)

export function useChatSocketContext(): ChatSocket {
  const value = use(ChatSocketContext)
  if (!value) throw new Error('useChatSocketContext는 <ChatSocketProvider> 안에서만 쓸 수 있습니다.')
  return value
}
