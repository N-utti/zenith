/**
 * 데스크탑 셸(Tauri) 연동.
 *
 * 프론트엔드는 Tauri npm 패키지에 의존하지 않는다. 같은 코드가 브라우저에서도
 * 그대로 돌아야 하기 때문이다. 대신 셸이 `withGlobalTauri`로 노출하는
 * `window.__TAURI__` 전역만 쓰고, 없으면 아무 일도 하지 않는다.
 */

import { serverOrigin } from './serverOrigin'

/** 셸 창 하나. 창 틀을 끈 셸(`decorations: false`)에서 웹앱이 최소화·최대화·닫기 단추를 직접 그린다. */
export interface TauriWindow {
  minimize: () => Promise<void>
  toggleMaximize: () => Promise<void>
  close: () => Promise<void>
  isMaximized: () => Promise<boolean>
  onResized: (handler: () => void) => Promise<() => void>
}

interface TauriGlobal {
  core: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> }
  /** 테스트의 가짜 전역에는 없다. 창 단추(`WindowControls`)만 쓴다. */
  window?: { getCurrentWindow: () => TauriWindow }
  /** 셸이 보내는 이벤트. 테스트의 가짜 전역에는 없다. */
  event?: { listen: (event: string, handler: () => void) => Promise<() => void> }
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
 * 그림은 앱 자신과 붙은 서버에서만 받는다. 문서·채팅에 섞여 든 바깥 그림 주소가 사내망 밖으로
 * 요청을 내지 못하게 한다(CSS `url()` 도 같은 규칙을 따른다).
 *
 * 웹은 Caddy 의 보안 정책 헤더(`img-src 'self' data:`)가 막는다. 셸은 그 헤더를 받지 않고, 셸 정책
 * (`tauri.conf.json`)은 서버 주소를 몰라 `http: https:` 를 연다. 서버 주소는 실행 중에 정해지므로
 * (현장 탈출구 포함) 여기서 정책을 하나 더 건다. 브라우저는 두 정책을 다 만족하는 그림만 받는다.
 * 첫 그림이 그려지기 전에 불러야 한다. 스크립트의 `fetch` 는 이 정책이 아니라 연결 정책을 따른다.
 */
export function restrictImageSources(): void {
  if (!isDesktopShell()) return
  // 오리진만 쓴다. 경로가 붙으면 그 경로 밖의 그림이 막히고, `*` 같은 값은 전부 연다.
  // 주소로 읽히지 않으면 서버를 빼서 닫힌 쪽으로 둔다.
  let server = ''
  try {
    server = new URL(serverOrigin()).origin
  } catch {
    // 서버 주소가 비었거나 주소가 아니다.
  }
  const meta = document.createElement('meta')
  meta.httpEquiv = 'Content-Security-Policy'
  meta.content = `img-src 'self' data: ${server}`.trim()
  document.head.append(meta)
}

/**
 * 주소를 앱 밖에서 연다. 셸은 기본 브라우저로, 브라우저는 새 탭으로.
 * 셸에서 `window.open` 을 쓰면 주소창 없는 앱 창이 떠서 나눈다.
 */
export function openExternal(url: string): void {
  const tauri = typeof window !== 'undefined' ? window.__TAURI__ : undefined
  if (tauri) {
    void tauri.core
      .invoke('plugin:opener|open_url', { url, with: null })
      .catch((e: unknown) => console.warn('바깥 주소 열기 실패', e))
  } else if (/^https?:/i.test(url)) {
    window.open(url, '_blank', 'noopener')
  } else {
    // 메일·전화 주소를 새 탭으로 열면 빈 탭이 남는다.
    location.href = url
  }
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
    // 휠 클릭은 click 이 아니라 auxclick 으로 온다. 같이 넘기지 않으면 주소창 없는 새 창에서 열린다.
    if (event.defaultPrevented || (event.button !== 0 && event.button !== 1)) return

    const target = event.target
    const anchor = target instanceof Element ? target.closest('a[href]') : null
    if (!(anchor instanceof HTMLAnchorElement)) return

    // href 프로퍼티는 이미 절대 URL로 해석돼 있다. 앱 내부 이동은 셸 오리진과
    // 같으므로 여기서 걸러지고, react-router가 평소대로 처리한다.
    if (!/^https?:$/i.test(anchor.protocol)) return
    if (anchor.origin === location.origin) return

    event.preventDefault()
    openExternal(anchor.href)
  }

  document.addEventListener('click', onClick)
  document.addEventListener('auxclick', onClick)
  return () => {
    document.removeEventListener('click', onClick)
    document.removeEventListener('auxclick', onClick)
  }
}

/**
 * 트레이 「종료」를 누르면 `beforeQuit`(로그아웃)을 마친 뒤 셸을 끈다. 실패해도 끈다. 셸은 답이 없으면
 * 3초 뒤에 어차피 끈다(`request_quit`). 브라우저에서는 아무 일도 하지 않는다.
 *
 * @returns 해제 함수.
 */
export function onQuitRequested(beforeQuit: () => Promise<void>): () => void {
  const tauri = typeof window !== 'undefined' ? window.__TAURI__ : undefined
  if (!tauri?.event) return () => {}
  const unlisten = tauri.event.listen('quit-requested', () => {
    void beforeQuit()
      .catch((error: unknown) => console.warn('종료 전 로그아웃 실패', error))
      .finally(() => tauri.core.invoke('quit_app').catch(() => {}))
  })
  return () => void unlisten.then((off) => off())
}

/**
 * 서버에 새 버전이 있으면 그 번호를, 없으면 null 을 돌려준다. 묻고 설치하는 화면은 `UpdateCard` 가 한다.
 *
 * 서버 주소를 모르면(개발 모드, 브라우저) 확인할 곳이 없으니 null 이다. 서버가 매니페스트를 아직
 * 안 내놓았거나 사내망 밖이면 콘솔에만 남기고 null 이다. 다음 확인 때 다시 본다.
 */
export async function findUpdate(): Promise<string | null> {
  const tauri = typeof window !== 'undefined' ? window.__TAURI__ : undefined
  const origin = serverOrigin()
  if (!tauri || !origin) return null
  try {
    const version = await tauri.core.invoke('check_update', { origin })
    return typeof version === 'string' ? version : null
  } catch (error) {
    console.warn('업데이트 확인 실패', error)
    return null
  }
}

/**
 * `findUpdate` 가 찾아 둔 새 버전을 셸이 받아서 설치한다. 앱이 닫혔다가 다시 뜬다.
 *
 * 사용자가 고른 뒤에만 부른다. 설치에는 관리자 확인(UAC)이 필요하다. 권한이 없는 사람이 묻지도 않고
 * 설치로 넘어가면 앱이 꺼진 채로 남고, 켤 때마다 되풀이된다.
 */
export async function installUpdate(): Promise<void> {
  await window.__TAURI__?.core.invoke('install_update')
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
 * 브라우저에서는 아무 일도 하지 않는다. 웹에서도 알림을 띄우려면 별도로
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
    // 플러그인의 notify 는 데스크톱에서 클릭을 못 받는다. 셸의 명령이 띄우고 누르면 창을 꺼낸다.
    await tauri.core.invoke('notify', { title: options.title, body: options.body })
  } catch {
    // 무시한다. 알림은 부가 기능이다.
  }
}

/**
 * Windows 알림 센터에 쌓인 채팅 알림(본문 포함)을 지운다. 로그인·로그아웃 때 부른다. 공용 PC 에서 다음
 * 사람이 알림 센터로 앞사람의 DM 을 읽지 않게 한다. 브라우저에서는 아무 일도 하지 않는다.
 */
export function clearNotifications(): void {
  const tauri = typeof window !== 'undefined' ? window.__TAURI__ : undefined
  if (!tauri) return
  // 못 지워도 로그인·로그아웃은 진행한다. 콘솔에만 남긴다.
  tauri.core
    .invoke('clear_notifications')
    .catch((error: unknown) => console.warn('알림 센터 비우기 실패', error))
}
