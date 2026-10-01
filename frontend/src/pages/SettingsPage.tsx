import { useState, type FormEvent } from 'react'
import { Moon, Sun } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Spinner } from '@/components/ui/Spinner'
import { useToast } from '@/components/ui/ToastContext'
import { DelegationSection } from '@/features/approvals/DelegationSection'
import { useCurrentUser } from '@/features/auth/AuthContext'
import {
  START_PAGES,
  usePreferences,
  useUpdatePreferences,
  type NotificationKind,
  type PreferencesPatch,
  type StartPage,
} from '@/features/settings/preferences'
import { api, ApiError } from '@/lib/api'
import { hueOf } from '@/lib/avatar'
import { setContentWide, useContentWide } from '@/lib/contentWidth'
import { useTheme } from '@/lib/theme'
import { DEMO_PASSWORD, MSW_ENABLED } from '@/mocks/accounts'
import { PASSWORD_MIN, ROLE_LABEL } from '@/types'

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

/**
 * 끌 수 있는 알림. 서버는 `comment`·`reply` 도 받지만 지금 그 종류를 만드는 곳이 없어
 * 토글을 두면 눌러도 아무 일이 없다(backend/README 17 (b)). 만들기 시작하면 여기 더한다.
 */
const NOTIFICATION_TOGGLES: { kind: NotificationKind; label: string; description: string }[] = [
  { kind: 'mention', label: '멘션', description: '채팅·문서 댓글에서 나를 @로 부를 때' },
  { kind: 'post', label: '새 게시글', description: '볼 수 있는 게시판에 글이 올라올 때' },
  { kind: 'attendance', label: '근태', description: '휴가·예외 근무 신청과 승인 결과' },
  { kind: 'approval', label: '전자결재', description: '결재 요청과 결재 결과' },
]

/**
 * 서버에 남는 설정. 다른 기기에서 로그인해도 같다. 고르는 즉시 저장한다(저장 버튼 없음).
 *
 * 끈 알림은 **앞으로 오는 것만** 막는다. 이미 쌓인 알림은 그대로고, 끈 동안 온 것은 켜도 돌아오지 않는다.
 */
function PreferencesSection() {
  const toast = useToast()
  const { data, isPending, isError } = usePreferences()
  const update = useUpdatePreferences()

  const save = (patch: PreferencesPatch) =>
    update.mutate(patch, {
      onError: (err) =>
        toast.error(err instanceof ApiError ? err.message : '설정을 저장하지 못했습니다.'),
    })

  return (
    <section className="border-line bg-surface mt-4 rounded-xl border p-6">
      <h2 className="text-fg mb-1 text-sm font-semibold">알림과 시작 화면</h2>
      <p className="text-muted mb-4 text-sm">
        서버에 저장되어 다른 기기에서도 같습니다. 끈 알림은 앞으로 오는 것만 막습니다.
      </p>
      {isPending && <Spinner />}
      {isError && <p className="text-muted text-sm">설정을 불러오지 못했습니다.</p>}
      {data && (
        <div className="max-w-sm space-y-5">
          <fieldset className="space-y-3">
            <legend className="text-fg mb-2 text-sm font-medium">받을 알림</legend>
            {NOTIFICATION_TOGGLES.map(({ kind, label, description }) => (
              <Checkbox
                key={kind}
                label={label}
                description={description}
                checked={data.notifications[kind]}
                // 저장 중에 또 누르면 응답 순서가 뒤집혀 화면과 서버가 갈릴 수 있다. 끝날 때까지 막는다.
                disabled={update.isPending}
                onChange={(e) => save({ notifications: { [kind]: e.target.checked } })}
              />
            ))}
          </fieldset>
          <Field label="로그인하면 처음 열 화면">
            {(slot) => (
              <Select
                {...slot}
                options={START_PAGES}
                value={data.start_page}
                disabled={update.isPending}
                onChange={(e) => save({ start_page: e.target.value as StartPage })}
              />
            )}
          </Field>
        </div>
      )}
    </section>
  )
}

export function SettingsPage() {
  const user = useCurrentUser()
  const { theme, setTheme } = useTheme()
  const wide = useContentWide()

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

      <PreferencesSection />

      <DelegationSection />

      <section className="border-line bg-surface mt-4 rounded-xl border p-6">
        <h2 className="text-fg mb-1 text-sm font-semibold">화면</h2>
        <p className="text-muted mb-4 text-sm">테마와 본문 너비는 이 브라우저에만 저장됩니다.</p>
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
        <h3 className="text-fg mt-5 mb-1 text-sm font-medium">본문 너비</h3>
        <p className="text-muted mb-3 text-sm">
          넓게를 고르면 근태 표나 목록이 모니터 폭을 다 씁니다. 문서 편집처럼 이미 화면을 꽉 채우는
          화면은 그대로입니다.
        </p>
        <div className="flex gap-2">
          <Button
            variant={wide ? 'secondary' : 'primary'}
            size="sm"
            aria-pressed={!wide}
            onClick={() => setContentWide(false)}
          >
            기본
          </Button>
          <Button
            variant={wide ? 'primary' : 'secondary'}
            size="sm"
            aria-pressed={wide}
            onClick={() => setContentWide(true)}
          >
            넓게
          </Button>
        </div>
      </section>
    </>
  )
}
