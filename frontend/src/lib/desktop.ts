/**
 * 데스크탑 셸(Tauri) 연동.
 *
 * 프론트엔드는 Tauri npm 패키지에 의존하지 않는다 — 같은 코드가 브라우저에서도
 * 그대로 돌아야 하기 때문이다. 대신 셸이 `withGlobalTauri`로 노출하는
 * `window.__TAURI__` 전역만 쓰고, 없으면 아무 일도 하지 않는다.
 */

interface TauriGlobal {
  core: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> }
}

declare global {
  interface Window {
    __TAURI__?: TauriGlobal
  }
}

export function isDesktopShell(): boolean {
  return typeof window !== 'undefined' && window.__TAURI__ !== undefined
}

/**
 * 바깥 링크를 기본 브라우저로 넘긴다.
 *
 * 셸에는 주소창도 뒤로 가기도 없다. 그냥 두면 Notion 링크 하나를 눌렀을 때
 * 앱 화면이 그 페이지로 바뀌고 돌아올 방법이 없다.
 *
 * @returns 해제 함수. 셸 밖(브라우저)에서는 아무것도 하지 않는다.
 */
export function installExternalLinkHandler(): () => void {
  const tauri = typeof window !== 'undefined' ? window.__TAURI__ : undefined
  if (!tauri) return () => {}

  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0) return

    const target = event.target
    const anchor = target instanceof Element ? target.closest('a[href]') : null
    if (!(anchor instanceof HTMLAnchorElement)) return

    // href 프로퍼티는 이미 절대 URL로 해석돼 있다. 앱 내부 이동은 셸 오리진과
    // 같으므로 여기서 걸러지고, react-router가 평소대로 처리한다.
    if (!/^https?:$/i.test(anchor.protocol)) return
    if (anchor.origin === location.origin) return

    event.preventDefault()
    void tauri.core.invoke('plugin:opener|open_url', { url: anchor.href, with: null })
  }

  document.addEventListener('click', onClick)
  return () => document.removeEventListener('click', onClick)
}

export interface DesktopNotification {
  title: string
  body?: string
}

/**
 * 권한은 한 번만 묻는다. 사용자가 거절했으면 그 결과도 그대로 붙잡아,
 * 메시지가 올 때마다 다시 물어보는 일이 없게 한다.
 */
let permission: Promise<boolean> | null = null

function ensurePermission(tauri: TauriGlobal): Promise<boolean> {
  permission ??= (async () => {
    if ((await tauri.core.invoke('plugin:notification|is_permission_granted')) === true) return true
    return (await tauri.core.invoke('plugin:notification|request_permission')) === 'granted'
  })().catch(() => false)

  return permission
}

/**
 * OS 알림(Windows 토스트)을 띄운다.
 *
 * 브라우저에서는 아무 일도 하지 않는다 — 웹에서도 알림을 띄우려면 별도로
 * Web Notification API를 붙여야 하고, 그건 권한 UX가 완전히 다르다.
 *
 * 알림이 실패해도 부르는 쪽은 알 필요가 없다. 채팅 수신이 알림 때문에
 * 끊기면 안 되므로 여기서 삼킨다.
 */
export async function notify(options: DesktopNotification): Promise<void> {
  const tauri = typeof window !== 'undefined' ? window.__TAURI__ : undefined
  if (!tauri) return

  try {
    if (!(await ensurePermission(tauri))) return
    await tauri.core.invoke('plugin:notification|notify', { options })
  } catch {
    // 무시한다. 알림은 부가 기능이다.
  }
}
