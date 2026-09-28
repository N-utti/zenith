import { useEffect, useEffectEvent, type RefObject } from 'react'

/**
 * 포커스를 가둘 수 있는 요소들. `[hidden]`은 제외해야 숨은 버튼으로 포커스가 새지 않는다.
 * 탭에서 뺀 요소(`tabindex="-1"`, ⌘K 의 결과 줄)도 뺀다. 세면 "마지막 요소" 를 잘못 알아 Tab 이 패널
 * 밖으로 빠져나간다.
 */
const TABBABLE = ':not([tabindex="-1"])'
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]',
]
  .map((selector) => selector + TABBABLE)
  .join(',')

/**
 * 대화상자용 포커스 가둠. `Modal`에서 뽑아냈다. 모달·⌘K 팔레트·모바일 서랍이 같이 쓴다
 * (12 UI 청사진 §8 접근성 규약).
 *
 *   1. 열리면 안의 첫 요소로 포커스를 옮긴다.
 *   2. Tab이 패널 밖으로 나가지 않는다.
 *   3. Esc로 닫는다.
 *   4. 닫히면 열었던 요소로 포커스를 되돌린다.
 *
 * 겹쳐 열리면(서랍 위 모달 등) 맨 위 것만 키를 받는다. 리스너가 모두 document 에 붙어
 * 등록 순서대로 돌기 때문에, 이렇게 안 하면 Esc 한 번에 아래 것까지 같이 닫힌다.
 */
const openTraps: symbol[] = []

export function useFocusTrap(
  open: boolean,
  panelRef: RefObject<HTMLElement | null>,
  onClose: () => void,
) {
  // 호출부의 onClose 는 대개 매 렌더 새로 만들어지는 화살표 함수다. 그걸 이펙트 의존성에 두면
  // 입력 한 글자마다 이펙트가 다시 돌아 포커스가 첫 요소로 튄다. 이펙트 이벤트로 최신 것만 본다.
  const requestClose = useEffectEvent(() => onClose())

  useEffect(() => {
    if (!open) return

    // 닫을 때 돌아갈 자리. 열었던 요소로 포커스를 되돌린다.
    const opener = document.activeElement as HTMLElement | null

    const panel = panelRef.current
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? panel)?.focus()

    const token = Symbol()
    openTraps.push(token)

    const onKeyDown = (e: KeyboardEvent) => {
      if (openTraps[openTraps.length - 1] !== token) return
      if (e.key === 'Escape') {
        e.preventDefault()
        return requestClose()
      }
      if (e.key !== 'Tab' || !panel) return

      const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.offsetParent !== null,
      )
      if (items.length === 0) return

      const edge = e.shiftKey ? items[0] : items[items.length - 1]
      if (document.activeElement === edge) {
        e.preventDefault()
        ;(e.shiftKey ? items[items.length - 1] : items[0]).focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      openTraps.splice(openTraps.indexOf(token), 1)
      opener?.focus()
    }
  }, [open, panelRef])
}
