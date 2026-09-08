import { useCallback, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, Check, Info, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { ToastContext, type ToastApi, type ToastTone } from './ToastContext'

interface Toast {
  id: number
  tone: ToastTone
  message: string
}

/** 성공은 잠깐, 실패는 오래. 읽고 대응할 시간이 필요하다. */
const LIFETIME: Record<ToastTone, number> = {
  success: 3200,
  info: 3200,
  error: 6000,
}

const TONES: Record<ToastTone, { icon: typeof Check; className: string }> = {
  success: { icon: Check, className: 'text-success' },
  error: { icon: AlertTriangle, className: 'text-danger' },
  info: { icon: Info, className: 'text-accent' },
}

/**
 * 토스트. 신청 완료·승인·저장처럼 **화면이 바뀌지 않는 성공**을 알린다.
 *
 * 지금까지 성공을 알릴 방법이 없었다(12 UI 청사진 §5). 근태의 신청·승인은
 * 목록의 상태 한 글자만 바뀌므로, 알림이 없으면 눌렸는지조차 알 수 없다.
 *
 * 실패는 원칙적으로 토스트가 아니라 **입력 옆**에 낸다(`Field`의 error). 여기의
 * error는 폼 밖에서 터지는 것. 승인 실패, 마감된 달 신청, 네트워크 끊김처럼
 * 되돌아가 고칠 입력이 없는 경우다.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((toast) => toast.id !== id))
  }, [])

  const push = useCallback(
    (tone: ToastTone, message: string) => {
      const id = nextId.current++
      setToasts((list) => [...list, { id, tone, message }])
      window.setTimeout(() => dismiss(id), LIFETIME[tone])
    },
    [dismiss],
  )

  const api = useMemo<ToastApi>(
    () => ({
      success: (message) => push('success', message),
      error: (message) => push('error', message),
      info: (message) => push('info', message),
    }),
    [push],
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  )
}

/**
 * 라이브 리전 두 개를 **항상** 그린다. 토스트가 뜰 때 컨테이너째 삽입하면
 * 스크린리더가 그 안의 글을 읽지 않는다. 라이브 리전은 미리 있어야 변화를 감지한다.
 *
 * polite와 assertive를 나눈 이유: 성공은 하던 일을 끊지 않고 뒤에 읽혀야 하고,
 * 실패는 지금 끊고 읽혀야 한다.
 */
function ToastViewport({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  const polite = toasts.filter((toast) => toast.tone !== 'error')
  const assertive = toasts.filter((toast) => toast.tone === 'error')

  return createPortal(
    <div
      // 모바일 하단 탭바(56px)와 iOS 홈 인디케이터를 피한다. md 이상에는 탭바가 없다.
      className="pointer-events-none fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-50 flex flex-col items-center gap-2 px-4 md:bottom-6 md:left-auto md:items-end md:pr-6"
    >
      <ToastList toasts={polite} live="polite" onDismiss={onDismiss} />
      <ToastList toasts={assertive} live="assertive" onDismiss={onDismiss} />
    </div>,
    document.body,
  )
}

function ToastList({
  toasts,
  live,
  onDismiss,
}: {
  toasts: Toast[]
  live: 'polite' | 'assertive'
  onDismiss: (id: number) => void
}) {
  return (
    <div
      aria-live={live}
      // status/alert 롤이 이미 라이브 리전을 뜻하므로 role은 안쪽 카드가 아니라 여기 둔다.
      role={live === 'assertive' ? 'alert' : 'status'}
      className="contents"
    >
      {toasts.map((toast) => {
        const { icon: Icon, className } = TONES[toast.tone]
        return (
          <div
            key={toast.id}
            className="bg-surface border-line pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-lg border p-3 shadow-lg"
          >
            <Icon className={cn('mt-0.5 size-4 shrink-0', className)} />
            <p className="text-fg flex-1 text-sm">{toast.message}</p>
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              aria-label="알림 닫기"
              className="text-subtle hover:text-fg -m-1 shrink-0 p-1 transition-colors"
            >
              <X className="size-3.5" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
