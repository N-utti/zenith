import { use } from 'react'
import { WifiOff } from 'lucide-react'
import { ConnectionLostContext } from './connectionLost'

/**
 * 서버 연결이 끊겼을 때 화면 상단에 한 줄(05 상태 공통 · 12 §5 오프라인/연결 끊김).
 *
 * 판단은 채팅 소켓 하나로 한다. 로그인 구역 전체를 감싸고 끊기면 알아서 다시 붙으니, 서버가
 * 살아 있는지를 셸에서 알 수 있는 유일한 자리다. 편집은 에디터가 따로 오프라인 배지로
 * 알린다(편집은 IndexedDB 에 남는다).
 */
export function ConnectionBanner() {
  if (!use(ConnectionLostContext)) return null

  return (
    <div
      role="status"
      className="bg-warning/15 text-warning flex shrink-0 items-center justify-center gap-2 px-4 py-1.5 text-[13px] font-medium"
    >
      <WifiOff className="size-4" />
      서버와 연결이 끊겼습니다. 다시 연결하는 중입니다.
    </div>
  )
}
