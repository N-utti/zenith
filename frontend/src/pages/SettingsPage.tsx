import { Moon, Sun } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { useCurrentUser } from '@/features/auth/AuthContext'
import { useTheme } from '@/lib/theme'
import { ROLE_LABEL } from '@/types'

export function SettingsPage() {
  const user = useCurrentUser()
  const { theme, setTheme } = useTheme()

  return (
    <>
      <PageHeader title="설정" />

      <section className="border-line bg-surface rounded-xl border p-6">
        <h2 className="text-fg mb-4 text-sm font-semibold">계정</h2>
        <div className="flex items-center gap-4">
          <Avatar name={user.name} hue={user.avatarHue} size="lg" />
          <div className="min-w-0">
            <p className="text-fg font-medium">
              {user.name} <span className="text-subtle text-sm font-normal">{user.title}</span>
            </p>
            <p className="text-muted text-sm">{user.email}</p>
            <div className="mt-2 flex gap-1.5">
              <Badge tone="accent">{ROLE_LABEL[user.role]}</Badge>
              <Badge>{user.team.name}</Badge>
            </div>
          </div>
        </div>
      </section>

      <section className="border-line bg-surface mt-4 rounded-xl border p-6">
        <h2 className="text-fg mb-1 text-sm font-semibold">화면</h2>
        <p className="text-muted mb-4 text-sm">테마는 이 브라우저에만 저장됩니다.</p>
        <div className="flex gap-2">
          <Button
            variant={theme === 'light' ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setTheme('light')}
          >
            <Sun className="size-4" />
            라이트
          </Button>
          <Button
            variant={theme === 'dark' ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setTheme('dark')}
          >
            <Moon className="size-4" />
            다크
          </Button>
        </div>
      </section>
    </>
  )
}
