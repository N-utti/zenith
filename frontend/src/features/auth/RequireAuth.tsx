import { Navigate, Outlet, useLocation } from 'react-router'
import { Spinner } from '@/components/ui/Spinner'
import { useAuth } from './AuthContext'

export function RequireAuth() {
  const { status } = useAuth()
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

  return <Outlet />
}
