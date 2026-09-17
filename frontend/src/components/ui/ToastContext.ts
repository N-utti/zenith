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
