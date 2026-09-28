import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { LogOut, Settings } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { useToast } from '@/components/ui/ToastContext'
import { useAuth, useCurrentUser } from '@/features/auth/AuthContext'
import { hueOf } from '@/lib/avatar'
import { ROLE_LABEL } from '@/types'

export function UserMenu() {
  const user = useCurrentUser()
  const { logout } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="hover:bg-surface-hover flex cursor-pointer items-center gap-2 rounded-lg p-1 transition-colors"
      >
        <Avatar name={user.name} hue={hueOf(user.id)} size="sm" />
        <span className="text-fg hidden text-sm font-medium sm:inline">{user.name}</span>
      </button>

      {open && (
        <div
          role="menu"
          className="border-line bg-surface absolute right-0 z-40 mt-2 w-60 rounded-xl border p-1.5 shadow-lg"
        >
          <div className="flex items-center gap-3 px-2.5 py-2">
            <Avatar name={user.name} hue={hueOf(user.id)} />
            <div className="min-w-0">
              <p className="text-fg truncate text-sm font-medium">{user.name}</p>
              <p className="text-muted truncate text-xs">{user.email}</p>
            </div>
          </div>
          <div className="px-2.5 pb-2">
            <Badge tone="accent">{ROLE_LABEL[user.role]}</Badge>{' '}
            {user.team && <Badge>{user.team.name}</Badge>}
          </div>

          <div className="border-line my-1 border-t" />

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              void navigate('/settings')
            }}
            className="text-muted hover:bg-surface-hover hover:text-fg flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm"
          >
            <Settings className="size-4" />
            설정
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              // 네트워크 오류면 서버 세션이 살아 있다. 조용히 넘기면 로그아웃한 줄 알고 자리를 뜬다.
              logout().catch(() =>
                toast.error('로그아웃하지 못했습니다. 네트워크를 확인하고 다시 시도하세요.'),
              )
            }}
            className="text-danger hover:bg-danger/10 flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm"
          >
            <LogOut className="size-4" />
            로그아웃
          </button>
        </div>
      )}
    </div>
  )
}
