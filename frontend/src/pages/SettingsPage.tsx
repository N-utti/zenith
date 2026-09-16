import { useState, type FormEvent } from 'react'
import { Moon, Sun } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { Spinner } from '@/components/ui/Spinner'
import { useToast } from '@/components/ui/ToastContext'
import { useCurrentUser } from '@/features/auth/AuthContext'
import { api, ApiError } from '@/lib/api'
import { hueOf } from '@/lib/avatar'
import { useTheme } from '@/lib/theme'
import { DEMO_PASSWORD, MSW_ENABLED } from '@/mocks/accounts'
import { ROLE_LABEL } from '@/types'

/** 서버 `PasswordIn.new_password` 의 min_length(backend/app/config.py `password_min_length`)와 같은 값. */
const PASSWORD_MIN = 8

/**
 * 개발 목(mock) 모드에서만 세 칸을 미리 채운다. 토스트를 보려고 매번 같은 값을 세 번 타이핑하지 않게.
 * 로그인 화면의 목 계정 버튼과 같은 편의다. 실제 서버에 붙이면(`VITE_DISABLE_MSW=true`) 빈 칸이고,
 * 검증도 요청도 그대로 돈다. 칸을 고쳐 넣으면 불일치·400 경로도 여전히 확인할 수 있다.
 */
const SEED = MSW_ENABLED ? DEMO_PASSWORD : ''

/** 서버에 보내기 전에 잡을 수 있는 오류. 어느 칸이 틀렸는지 알 수 있으니 그 칸에 붙인다. 현재 비밀번호는 서버만 안다. */
function passwordFormError(next: string, confirm: string) {
  return {
    next: next.length < PASSWORD_MIN ? `새 비밀번호는 ${PASSWORD_MIN}자 이상이어야 합니다.` : null,
    confirm: next !== confirm ? '새 비밀번호와 다릅니다.' : null,
  }
}

function PasswordSection() {
  const toast = useToast()
  const [current, setCurrent] = useState(SEED)
  const [next, setNext] = useState(SEED)
  const [confirm, setConfirm] = useState(SEED)
  const [currentError, setCurrentError] = useState<string | null>(null)
  const [nextError, setNextError] = useState<string | null>(null)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setCurrentError(null)
    const error = passwordFormError(next, confirm)
    setNextError(error.next)
    setConfirmError(error.confirm)
    if (error.next || error.confirm) return

    setPending(true)
    try {
      await api<void>('/me/password', {
        method: 'POST',
        body: JSON.stringify({ current_password: current, new_password: next }),
      })
      // 실제 서버에서는 빈 칸으로 돌아간다. 목 모드에서는 바로 한 번 더 눌러 볼 수 있게 다시 채운다.
      setCurrent(SEED)
      setNext(SEED)
      setConfirm(SEED)
      // 서버가 이 세션만 남기고 나머지를 끊는다(backend/README §1 확장). 다른 기기에서 놀라지 않게 알린다.
      toast.success('비밀번호를 바꿨습니다. 다른 기기의 로그인은 모두 해제됩니다.')
    } catch (err) {
      if (err instanceof ApiError && err.code === 'PASSWORD_MISMATCH') setCurrentError(err.message)
      else toast.error(err instanceof ApiError ? err.message : '비밀번호를 바꾸지 못했습니다.')
    } finally {
      setPending(false)
    }
  }

  return (
    <section className="border-line bg-surface mt-4 rounded-xl border p-6">
      <h2 className="text-fg mb-1 text-sm font-semibold">비밀번호</h2>
      <p className="text-muted mb-4 text-sm">
        바꾸면 지금 쓰는 기기만 남고 다른 기기는 다시 로그인해야 합니다.
      </p>
      <form onSubmit={submit} className="max-w-sm space-y-4">
        <Field label="현재 비밀번호" required error={currentError}>
          {(slot) => (
            <Input
              {...slot}
              type="password"
              required
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          )}
        </Field>
        <Field label="새 비밀번호" required hint={`${PASSWORD_MIN}자 이상`} error={nextError}>
          {(slot) => (
            <Input
              {...slot}
              type="password"
              required
              minLength={PASSWORD_MIN}
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
          )}
        </Field>
        <Field label="새 비밀번호 확인" required error={confirmError}>
          {(slot) => (
            <Input
              {...slot}
              type="password"
              required
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          )}
        </Field>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? <Spinner className="border-t-on-accent" /> : '비밀번호 변경'}
        </Button>
      </form>
    </section>
  )
}

export function SettingsPage() {
  const user = useCurrentUser()
  const { theme, setTheme } = useTheme()

  return (
    <>
      <PageHeader title="설정" />

      <section className="border-line bg-surface rounded-xl border p-6">
        <h2 className="text-fg mb-4 text-sm font-semibold">계정</h2>
        <div className="flex items-center gap-4">
          <Avatar name={user.name} hue={hueOf(user.id)} size="lg" />
          <div className="min-w-0">
            <p className="text-fg font-medium">{user.name}</p>
            <p className="text-muted text-sm">{user.email}</p>
            <div className="mt-2 flex gap-1.5">
              <Badge tone="accent">{ROLE_LABEL[user.role]}</Badge>
              {user.team && <Badge>{user.team.name}</Badge>}
            </div>
          </div>
        </div>
      </section>

      <PasswordSection />

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
