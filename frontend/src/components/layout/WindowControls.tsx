import { useEffect, useState } from 'react'
import { Copy, Minus, Square, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { TauriWindow } from '@/lib/desktop'

/** 셸은 창 틀을 끈다(`decorations: false`). 전역에 창 묶음이 없으면(테스트의 가짜 전역 등) 단추를 안 그린다. */
const appWindow = (): TauriWindow | undefined => window.__TAURI__?.window?.getCurrentWindow()

/** 창 단추 셋의 폭. 탭 줄이 이만큼 오른쪽을 비운다. */
export const WINDOW_CONTROLS_WIDTH = 'pr-[138px]'

const BUTTON = 'text-muted grid w-[46px] cursor-pointer place-items-center'

/**
 * 창 오른쪽 위 최소화·최대화·닫기. 화면마다 그리지 않고 앱 바깥에 한 벌만 띄운다. 모달 바탕(z-50)보다 위라
 * 모달이 떠 있어도 창을 내리거나 닫을 수 있다. 닫기는 셸이 트레이로 숨긴다(lib.rs 의 CloseRequested).
 * 높이는 탭 줄보다 1px 낮다. 마우스를 올린 바탕이 탭 줄 아랫선을 덮지 않게.
 */
export function WindowControls() {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    const win = appWindow()
    if (!win) return
    const sync = () => void win.isMaximized().then(setMaximized, console.warn)
    sync()
    const off = win.onResized(sync)
    return () => void off.then((unlisten) => unlisten(), console.warn)
  }, [])

  const win = appWindow()
  if (!win) return null
  const run = (action: () => Promise<void>) => () => void action().catch(console.warn)

  return (
    <div className="fixed top-0 right-0 z-60 flex h-[35px]">
      <button
        type="button"
        aria-label="최소화"
        onClick={run(() => win.minimize())}
        className={cn(BUTTON, 'hover:bg-surface-hover')}
      >
        <Minus className="size-4" strokeWidth={1.25} />
      </button>
      <button
        type="button"
        aria-label={maximized ? '이전 크기로' : '최대화'}
        onClick={run(() => win.toggleMaximize())}
        className={cn(BUTTON, 'hover:bg-surface-hover')}
      >
        {maximized ? (
          <Copy className="size-3.5 -scale-x-100" strokeWidth={1.25} />
        ) : (
          <Square className="size-3.5" strokeWidth={1.25} />
        )}
      </button>
      <button
        type="button"
        aria-label="닫기"
        onClick={run(() => win.close())}
        className={cn(BUTTON, 'hover:bg-danger hover:text-on-accent')}
      >
        <X className="size-4" strokeWidth={1.25} />
      </button>
    </div>
  )
}

/**
 * 탭 줄이 없는 화면(로그인·불러오는 중·앱이 터진 화면)에서 창을 끌어 옮기는 투명한 띠.
 * 로그인한 화면에서는 AppLayout 의 탭 줄이 같은 자리를 덮고 그 줄이 끌기를 맡는다.
 */
export function DesktopTitleBar() {
  return (
    <>
      <div data-tauri-drag-region className="fixed inset-x-0 top-0 z-0 h-9" />
      <WindowControls />
    </>
  )
}
