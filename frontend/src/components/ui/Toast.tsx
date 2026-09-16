import type { CSSProperties, ReactNode } from 'react'
import { AlertTriangle, Check, Info } from 'lucide-react'
import { Toaster, toast } from 'sonner'
import 'sonner/dist/styles.css'
import { useTheme } from '@/lib/theme'
import { ToastContext, type ToastApi } from './ToastContext'

/** 성공은 잠깐, 실패는 오래. 읽고 대응할 시간이 필요하다. */
const LIFETIME = { success: 3200, info: 3200, error: 6000 }

/** 호출부는 이 셋만 안다. 라이브러리가 바뀌어도 여기만 바꾼다. */
const api: ToastApi = {
  success: (message) => {
    toast.success(message, { duration: LIFETIME.success })
  },
  error: (message) => {
    toast.error(message, { duration: LIFETIME.error })
  },
  info: (message) => {
    toast.info(message, { duration: LIFETIME.info })
  },
}

/** sonner 의 CSS 변수를 시맨틱 토큰으로 덮는다. 라이트·다크는 토큰이 알아서 바뀐다. */
const TOASTER_STYLE = {
  '--width': '384px',
  // 커맨드 팔레트·모달(z-50)보다 아래. 알림이 입력을 가리면 안 된다.
  '--z-index': '40',
  '--normal-bg': 'var(--zenith-surface)',
  '--normal-text': 'var(--zenith-fg)',
  '--normal-border': 'var(--zenith-line)',
  fontFamily: 'inherit',
} as CSSProperties

/**
 * 토스트. 신청 완료·승인·저장처럼 **화면이 바뀌지 않는 성공**을 알린다(12 UI 청사진 §5).
 * 진입·퇴장 애니메이션, 겹쳐 쌓기, 호버 중 타이머 정지, 스와이프 닫기는 sonner 가 한다.
 *
 * 실패는 원칙적으로 토스트가 아니라 **입력 옆**에 낸다(`Field`의 error). 여기의
 * error는 폼 밖에서 터지는 것. 승인 실패, 마감된 달 신청, 네트워크 끊김처럼
 * 되돌아가 고칠 입력이 없는 경우다.
 *
 * 위치는 헤더(50px) 바로 아래 가운데. 본문이 가운데(max-w-6xl)에 모여 있어 오른쪽 아래 구석은
 * 넓은 모니터·듀얼 모니터에서 시선 밖이라 놓친다. 모바일도 같은 자리(헤더 아래)다.
 *
 * ponytail: sonner 는 실패도 aria-live polite 로 읽는다. 이전 자체 구현은 실패만 assertive 였다.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const { theme } = useTheme()

  return (
    <ToastContext.Provider value={api}>
      {children}
      <Toaster
        theme={theme}
        position="top-center"
        offset={{ top: 62 }}
        mobileOffset={{ top: 62, left: 16, right: 16 }}
        closeButton
        icons={{
          success: <Check className="text-success size-4" />,
          error: <AlertTriangle className="text-danger size-4" />,
          info: <Info className="text-accent size-4" />,
        }}
        style={TOASTER_STYLE}
      />
    </ToastContext.Provider>
  )
}
