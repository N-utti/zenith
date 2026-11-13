import { Navigate, Outlet, useLocation } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Spinner } from '@/components/ui/Spinner'
import { useToast } from '@/components/ui/ToastContext'
import { ZenithMark } from '@/components/ui/ZenithMark'
import { useAuth } from './AuthContext'
import { PasswordForm } from './PasswordForm'
import type { User } from '@/types'
import { meQueryKey } from './queries'

export function RequireAuth() {
  const { status, user } = useAuth()
  const location = useLocation()

  if (status === 'loading') {
    return (
      <div className="bg-canvas grid h-full place-items-center">
        <Spinner className="size-6" />
      </div>
    )
  }

  if (status === 'anonymous') {
    // 로그인 후 원래 가려던 곳으로 돌려보내기 위해 경로를 넘긴다.
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  }

  // 관리자가 정해 준 비밀번호로 들어온 사람(백엔드 #601). 서버가 `/me`·비밀번호 변경·로그아웃 말고는
  // 전부 403, 소켓은 4428 로 막으므로 앱 틀(채팅 소켓·사이드바)을 아예 그리지 않는다.
  // 주소는 그대로 두어 바꾸고 나면 원래 가려던 화면이 바로 뜬다.
  if (user?.must_change_password) return <ForcedPasswordChange />

  return <Outlet />
}

function ForcedPasswordChange() {
  const { logout } = useAuth()
  const qc = useQueryClient()
  const toast = useToast()

  return (
    <div className="bg-canvas grid h-full place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <ZenithMark className="mx-auto mb-3 size-11" />
          <h1 className="text-fg text-xl font-semibold tracking-tight">비밀번호를 바꿔 주세요</h1>
          <p className="text-muted mt-1 text-sm">관리자가 정해 준 비밀번호로 로그인했습니다.</p>
        </div>
        <div className="border-line bg-surface rounded-xl border p-6 shadow-sm">
          <PasswordForm
            wide
            submitLabel="비밀번호 바꾸기"
            onChanged={() => {
              toast.success('비밀번호를 바꿨습니다.')
              // 204 가 곧 서버가 표시를 지웠다는 뜻이다. 다시 받지 않고 지운다(다시 받다 실패하면
              // 프로필 쿼리가 오류가 돼 로그인 화면으로 떨어진다). 위의 갈림이 앱으로 넘어간다.
              qc.setQueryData<User | null>(
                meQueryKey,
                (me) => me && { ...me, must_change_password: false },
              )
            }}
            onError={toast.error}
          />
        </div>
        <button
          type="button"
          onClick={() => void logout()}
          className="text-muted hover:text-fg mx-auto mt-4 block cursor-pointer text-sm"
        >
          로그아웃
        </button>
      </div>
    </div>
  )
}
