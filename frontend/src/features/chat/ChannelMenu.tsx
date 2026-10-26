import { useRef } from 'react'
import { MoreHorizontal } from 'lucide-react'
import type { ChatChannel } from './types'
import { useChannelMenu } from './useChannelMenu'

/**
 * 채팅 화면 머리줄의 더보기 버튼. 메뉴는 사이드바 방 줄의 우클릭과 같다(`useChannelMenu`).
 * 버튼 바로 아래에 띄운다.
 */
export function ChannelMenu({ channel }: { channel: ChatChannel }) {
  const menu = useChannelMenu(channel)
  /** 누르기 시작한 순간 메뉴가 열려 있었는가. 뗄 때는 이미 닫혀 있어 그때의 상태로는 알 수 없다. */
  const wasOpen = useRef(false)

  return (
    <>
      <button
        type="button"
        aria-label={`${channel.name} 더보기`}
        aria-haspopup="menu"
        aria-expanded={menu.isOpen}
        title="더보기"
        // 열린 채로 다시 누르면 닫는다. 메뉴는 누르는 순간 스스로 닫힌다(바깥 누름, 초점이 이
        // 버튼으로 옮겨 감). 그래서 뗄 때 보면 늘 닫혀 있고, 그대로 두면 이 클릭이 다시 연다.
        onPointerDown={() => (wasOpen.current = menu.isOpen)}
        onClick={(e) => {
          if (wasOpen.current) return menu.openAt(null)
          const rect = e.currentTarget.getBoundingClientRect()
          menu.openAt({ x: rect.left, y: rect.bottom + 4 })
        }}
        className="text-subtle hover:bg-surface-hover hover:text-fg grid size-8 shrink-0 cursor-pointer place-items-center rounded-lg transition-colors"
      >
        <MoreHorizontal className="size-4" />
      </button>
      {menu.element}
    </>
  )
}
