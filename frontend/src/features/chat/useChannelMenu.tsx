import { useState } from 'react'
import { ChannelMenuLayer, type Open, type Point } from './ChannelMenuLayer'
import type { ChatChannel } from './types'

/**
 * 방 하나의 메뉴. 머리줄 더보기와 사이드바 방 줄의 우클릭이 같이 쓴다. `element` 를 그 자리에 그린다.
 *
 * 줄은 무엇이 떠 있는지만 든다. 서버 호출·소켓·알림 구독은 뜬 동안만 붙는다. 줄마다 붙여 두면
 * 접속 표시가 바뀔 때마다 사이드바의 방 줄이 전부 다시 그려진다.
 */
export function useChannelMenu(channel: ChatChannel) {
  const [open, setOpen] = useState<Open | null>(null)
  return {
    isOpen: open?.kind === 'menu',
    openAt: (at: Point | null) => setOpen(at && { kind: 'menu', at }),
    element: open && <ChannelMenuLayer channel={channel} open={open} setOpen={setOpen} />,
  }
}
