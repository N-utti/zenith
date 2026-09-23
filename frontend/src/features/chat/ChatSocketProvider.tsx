import { Outlet } from 'react-router'
import { ConnectionLostContext, useConnectionLost } from '@/components/layout/connectionLost'
import { ChatSocketContext } from './ChatSocketContext'
import { useChatSocket } from './useChatSocket'

/**
 * 로그인 구역 전체를 감싸는 라우트 엘리먼트.
 *
 * AppLayout이 아니라 그 위에 두는 이유는, 라우트가 AppLayout을 두 벌
 * (`bleed` 유무) 쓰기 때문이다. 채팅에서 홈으로 옮기면 AppLayout이
 * 통째로 다시 마운트되므로, 거기에 소켓을 두면 화면을 옮길 때마다 끊긴다.
 */
export function ChatSocketProvider() {
  const socket = useChatSocket()
  const lost = useConnectionLost(socket.connected)

  return (
    <ChatSocketContext value={socket}>
      <ConnectionLostContext value={lost}>
        <Outlet />
      </ConnectionLostContext>
    </ChatSocketContext>
  )
}
