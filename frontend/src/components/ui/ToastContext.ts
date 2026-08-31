import { createContext, use } from 'react'

export type ToastTone = 'success' | 'error' | 'info'

export interface ToastApi {
  success: (message: string) => void
  error: (message: string) => void
  info: (message: string) => void
}

export const ToastContext = createContext<ToastApi | null>(null)

export function useToast(): ToastApi {
  const api = use(ToastContext)
  if (!api) throw new Error('useToast는 <ToastProvider> 안에서만 쓸 수 있습니다.')
  return api
}
