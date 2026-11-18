import { createContext, use } from 'react'
import { toast } from 'sonner'

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
   * 되돌리기를 누르지 않고 닫혔을 때(시간이 다 됐거나 밀어 닫기). 마우스를 올리거나 탭이 숨으면
   * 토스트의 시간이 멈추므로, 되돌릴 창이 끝나는 순간은 따로 재지 말고 이걸로 받는다.
   */
  onClose?: () => void
}

export interface ToastApi {
  success: (message: string, options?: ToastOptions) => void
  error: (message: string, options?: ToastOptions) => void
  info: (message: string, options?: ToastOptions) => void
}

/** 성공은 잠깐, 실패는 오래. 읽고 대응할 시간이 필요하다. */
const LIFETIME = { success: 3200, info: 3200, error: 6000 }

/** 호출부는 이 셋만 안다. 라이브러리가 바뀌어도 여기만 바꾼다. */
function opts(fallback: number, options?: ToastOptions) {
  return {
    duration: options?.durationMs ?? fallback,
    action: options?.action && { label: options.action.label, onClick: options.action.onClick },
    // 액션 버튼으로 닫힐 때는 둘 다 불리지 않는다.
    onAutoClose: options?.onClose,
    onDismiss: options?.onClose,
  }
}

/** 컴포넌트 밖(lib)에서 띄울 때. 화면 안에서는 `useToast()` 를 쓴다. */
export const toastApi: ToastApi = {
  success: (message, options) => {
    toast.success(message, opts(LIFETIME.success, options))
  },
  error: (message, options) => {
    toast.error(message, opts(LIFETIME.error, options))
  },
  info: (message, options) => {
    toast.info(message, opts(LIFETIME.info, options))
  },
}

export const ToastContext = createContext<ToastApi | null>(null)

export function useToast(): ToastApi {
  const api = use(ToastContext)
  if (!api) throw new Error('useToast는 <ToastProvider> 안에서만 쓸 수 있습니다.')
  return api
}
