import { useCallback, useState, type MouseEvent } from 'react'
import { useLongPress } from './useLongPress'

export type MenuPoint = { x: number; y: number }

/**
 * 카드 하나의 우클릭 메뉴 자리. `triggers` 를 카드에 펼쳐 달고, `at` 이 있으면 `ContextMenu` 를 그린다.
 *
 * 마우스는 우클릭, 키보드는 Shift+F10·메뉴 키, 손가락 기기는 꾹 누르기(아이폰은 우클릭이 안 온다).
 * 키보드로 열면 포인터 좌표가 없어서 카드 바로 아래에 띄운다. 사이드바 방 줄과 같은 규칙이다.
 */
export function useContextMenuAt() {
  const [at, setAt] = useState<MenuPoint | null>(null)
  const longPress = useLongPress((_, x, y) => {
    setAt({ x, y })
    return true
  })
  // `ContextMenu` 가 이것을 이펙트 의존성으로 쓴다. 그릴 때마다 새로 만들면 바깥 누르기 감시를 매번 다시 붙인다.
  const close = useCallback(() => setAt(null), [])
  return {
    at,
    close,
    triggers: {
      ...longPress,
      'data-long-press': true,
      onContextMenu: (e: MouseEvent<HTMLElement>) => {
        e.preventDefault()
        const rect = e.currentTarget.getBoundingClientRect()
        setAt({ x: e.clientX || rect.left, y: e.clientY || rect.bottom })
      },
    },
  }
}
