import type { CSSProperties, ReactNode } from 'react'
import { AlertTriangle, Check, Info } from 'lucide-react'
import { Toaster } from 'sonner'
import { ToastContext, toastApi } from './ToastContext'

/**
 * sonner 의 CSS 변수를 시맨틱 토큰으로 덮는다. 토스트는 테마와 상관없이 늘 어둡다(토스·머티리얼식).
 * 흰 화면 위에서 가장 눈에 띄고, 듀얼 모니터에서 놓치지 않는다. 다크 테마에서 밝게 뒤집지 않은 건
 * 어두운 화면에 흰 상자가 튀면 눈이 부셔서다. 대신 화면보다 한 단계 밝은 면에 옅은 테두리로 가른다.
 * 컨테이너에 `dark` 클래스를 붙이므로 아래 토큰과 아이콘 색은 다크 팔레트로 풀린다(@theme inline).
 */
const TOASTER_STYLE = {
  // 최대 폭. 토스트는 문구 길이에 맞춰 줄고(w-fit), 가장 긴 문구("비밀번호를 바꿨습니다. 다른 기기의
  // 로그인은 모두 해제됩니다.")도 한 줄에 들어간다. 600px 미만에서는 sonner 가 화면 폭을 쓴다.
  '--width': '440px',
  // 커맨드 팔레트·모달(z-50)보다 아래. 알림이 입력을 가리면 안 된다.
  // sonner 의 `--z-index` 는 토스트끼리의 순서만 정하고, 컨테이너 자체는 CSS 에 999999999 로 박혀 있다.
  // 인라인 style 은 같은 엘리먼트에 얹히므로 그 규칙을 이긴다.
  zIndex: 40,
  '--normal-bg': 'var(--zenith-surface-hover)',
  '--normal-text': 'var(--zenith-fg)',
  '--normal-border': 'var(--zenith-line)',
  '--border-radius': '12px',
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
 * 위치는 헤더(50px) 바로 아래 가운데. 본문이 기본 너비에서는 가운데(max-w-6xl)에 모여 있어 오른쪽 아래 구석은
 * 넓은 모니터·듀얼 모니터에서 시선 밖이라 놓친다. 모바일도 같은 자리(헤더 아래)다.
 *
 * ponytail: sonner 는 실패도 aria-live polite 로 읽는다. 이전 자체 구현은 실패만 assertive 였다.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  return (
    <ToastContext.Provider value={toastApi}>
      {children}
      <Toaster
        theme="dark"
        className="dark"
        position="top-center"
        offset={{ top: 62 }}
        mobileOffset={{ top: 62, left: 16, right: 16 }}
        // 날짜·이름이 들어가 길어지는 문구(회사 휴일 등록 등)는 폭을 넘길 수 있다. 그때 한글이
        // 글자 중간에서 끊기지 않게 어절 단위로 넘긴다.
        // sonner CSS 는 레이어 밖이라 테일윈드 유틸리티가 지므로 ! 로 덮는다. 폭은 문구에 맞추고
        // 가운데로 모은다. ponytail: 여러 장이 접혀 쌓이면 뒤 토스트가 앞보다 넓을 때 옆으로 비친다.
        toastOptions={{
          classNames: {
            toast: 'w-fit! inset-x-0 mx-auto px-4! py-3! text-sm!',
            title: 'break-keep',
          },
        }}
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
