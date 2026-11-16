import { useEffect, useRef, useState, type ReactNode } from 'react'
import { DesktopTitleBar } from '@/components/layout/WindowControls'
import { Input } from '@/components/ui/Input'
import { ZenithMark } from '@/components/ui/ZenithMark'
import { useAuth, useCurrentUser } from '@/features/auth/AuthContext'
import { isDesktopShell } from '@/lib/desktop'
import { useFocusTrap } from '@/lib/useFocusTrap'
import { lockNow, setAppLock, unlockAppLock, useAppLock, useAutoLock } from './appLock'

/**
 * 잠금 모드를 켠 사람이면 앱 전체 위에 잠금 화면을 덮는다. 앱은 내리지 않고 덮기만 한다.
 * 쓰던 채팅 입력·문서 편집·소켓이 그대로 남아 풀면 하던 자리로 돌아온다. 뒤쪽은 `inert` 로
 * 초점·클릭·화면 읽기에서 뺀다(Tab 으로 뒤 화면에 닿지 않게).
 */
export function AppLockGate({ children }: { children: ReactNode }) {
  const user = useCurrentUser()
  const lock = useAppLock(user.id)
  useAutoLock(user.id, lock)

  const enabled = !!lock && !lock.locked
  useEffect(() => {
    if (!enabled) return
    // 한글 자판이어도 먹게 글쇠 자리(code)로 본다(데스크톱 탭 줄과 같다).
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'KeyL' || !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return
      e.preventDefault()
      lockNow(user.id)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled, user.id])

  const locked = !!lock?.locked
  // inert 는 초점·클릭만 막고 window 에 붙은 단축키(데스크톱 Ctrl+W·T·Tab, ⌘K, 모달 Esc)는 못 막는다.
  // 잠긴 동안은 잡는 단계에서 먼저 받아 뒤로 넘기지 않는다. 기본 동작은 두어 번호 칸의 붙여넣기 등은 된다.
  useEffect(() => {
    if (!locked) return
    const swallow = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.key === 'Escape') e.stopImmediatePropagation()
    }
    window.addEventListener('keydown', swallow, true)
    return () => window.removeEventListener('keydown', swallow, true)
  }, [locked])

  return (
    <>
      <div className="contents" inert={locked}>
        {children}
      </div>
      {locked && <LockScreen userId={user.id} name={user.name} />}
    </>
  )
}

function LockScreen({ userId, name }: { userId: string; name: string }) {
  const { logout } = useAuth()
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  // 모달·우클릭 메뉴처럼 body 에 바로 그린 것은 inert 밖이다. 잠기기 전에 열려 있었으면 Tab 으로
  // 거기 닿아 안 보이는 채 누를 수 있다. 맨 위 가둠만 키를 받으니 Tab·Esc 가 여기 머문다.
  useFocusTrap(true, ref, () => {})

  return (
    // 토스트(sonner)보다 위. 잠긴 동안 알림 문구로 뒤 화면 내용이 새지 않게.
    <div
      ref={ref}
      tabIndex={-1}
      // 빈 곳을 눌러도 초점이 번호 칸에서 빠지지 않게. 그대로 숫자를 치면 들어간다.
      onMouseDown={(e) => {
        if (!(e.target as HTMLElement).closest('button, input, [data-tauri-drag-region]'))
          e.preventDefault()
      }}
      className="bg-canvas fixed inset-0 z-[1000000000] grid place-items-center px-4 outline-none"
    >
      {/* 데스크톱 앱은 창 버튼과 끄는 자리가 화면 안에 있다(#635). 덮어 버리면 번호를 넣기 전에는
          창을 옮기지도 내리지도 못한다. 탭 제목은 가린 채 창 조절만 남긴다. */}
      {isDesktopShell() && <DesktopTitleBar />}
      <div className="w-full max-w-xs text-center">
        <ZenithMark className="mx-auto mb-3 size-11" />
        <h1 className="text-fg text-xl font-semibold tracking-tight">잠금 모드</h1>
        <p className="text-muted mt-1 text-sm">{name}님, 잠금 번호 4자리를 입력하세요.</p>
        <Input
          autoFocus
          type="password"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={4}
          aria-label="잠금 번호"
          aria-invalid={error ? true : undefined}
          value={pin}
          onChange={(e) => {
            const next = e.target.value.replace(/\D/g, '').slice(0, 4)
            setError(null)
            if (next.length === 4 && !unlockAppLock(userId, next)) {
              setError('번호가 맞지 않습니다.')
              setPin('')
              return
            }
            setPin(next)
          }}
          className="mt-6 text-center text-lg tracking-[0.5em]"
        />
        {error && (
          <p role="alert" className="text-danger mt-2 text-sm">
            {error}
          </p>
        )}
        <button
          type="button"
          // 다시 로그인하면 계정 비밀번호로 본인임을 밝힌 것이니 이 기기의 잠금 번호를 지운다.
          // 로그아웃이 실패했는데 먼저 지우면 잠금이 풀린 채 앱으로 들어간다. 끝난 뒤에 지운다.
          onClick={() =>
            logout().then(
              () => setAppLock(userId, null),
              () => setError('로그아웃하지 못했습니다. 네트워크를 확인하고 다시 시도하세요.'),
            )
          }
          className="text-muted hover:text-fg mx-auto mt-6 block cursor-pointer text-sm"
        >
          번호를 잊었다면 로그아웃
        </button>
      </div>
    </div>
  )
}
