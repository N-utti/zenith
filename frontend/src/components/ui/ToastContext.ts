import { createContext, use } from 'react'

/** 토스트 안의 되돌리기 같은 버튼. 되돌릴 창이 토스트가 떠 있는 동안뿐인 동작에 쓴다. */
export interface ToastAction {
  label: string
  onClick: () => void
}

export interface ToastOptions {
  action?: ToastAction
  /** 기본값보다 오래 두어야 할 때. 되돌릴 시간을 주는 토스트가 그렇다. */
  durationMs?: number
  /**
   * 되돌리기를 누르지 않고 닫혔을 때(시간이 다 됐거나 X·밀어 닫기). 마우스를 올리거나 탭이 숨으면
   * 토스트의 시간이 멈추므로, 되돌릴 창이 끝나는 순간은 따로 재지 말고 이걸로 받는다.
   */
  onClose?: () => void
}

export interface ToastApi {
  success: (message: string, options?: ToastOptions) => void
  error: (message: string, options?: ToastOptions) => void
  info: (message: string, options?: ToastOptions) => void
}

export const ToastContext = createContext<ToastApi | null>(null)

export function useToast(): ToastApi {
  const api = use(ToastContext)
  if (!api) throw new Error('useToast는 <ToastProvider> 안에서만 쓸 수 있습니다.')
  return api
}
