import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { Spinner } from '@/components/ui/Spinner'
import { markOnboarding } from '@/features/home/onboarding'
import { api, ApiError } from '@/lib/api'
import { DEMO_PASSWORD, MSW_ENABLED } from '@/mocks/accounts'
import { PASSWORD_MIN } from '@/types'

/**
 * 개발 목(mock) 모드에서만 칸을 미리 채운다. 토스트를 보려고 매번 같은 값을 세 번 타이핑하지 않게.
 * 로그인 화면의 목 계정 버튼과 같은 편의다. 실제 서버에 붙이면(`VITE_DISABLE_MSW=true`) 빈 칸이고,
 * 검증도 요청도 그대로 돈다. 새 비밀번호가 지금 것과 같으면 막히므로 다른 값을 넣는다.
 * 목은 비밀번호를 저장하지 않아 바꾼 뒤에도 로그인은 `DEMO_PASSWORD` 그대로다.
 */
const SEED_CURRENT = MSW_ENABLED ? DEMO_PASSWORD : ''
const SEED_NEXT = MSW_ENABLED ? `${DEMO_PASSWORD}!` : ''

/** 서버에 보내기 전에 잡을 수 있는 오류. 어느 칸이 틀렸는지 알 수 있으니 그 칸에 붙인다. */
function passwordFormError(current: string, next: string, confirm: string) {
  return {
    next:
      next.length < PASSWORD_MIN
        ? `새 비밀번호는 ${PASSWORD_MIN}자 이상이어야 합니다.`
        : next === current
          ? '지금 비밀번호와 다르게 정하세요.'
          : null,
    confirm: next !== confirm ? '새 비밀번호와 다릅니다.' : null,
  }
}

/**
 * `POST /me/password`. 설정 화면과 첫 로그인 강제 변경 화면이 같이 쓴다.
 * 오류는 칸에 붙이고, 칸으로 못 가르는 실패만 `onError` 로 넘긴다.
 */
export function PasswordForm({
  submitLabel,
  onChanged,
  onError,
  wide,
}: {
  submitLabel: string
  onChanged: () => void
  onError: (message: string) => void
  wide?: boolean
}) {
  const [current, setCurrent] = useState(SEED_CURRENT)
  const [next, setNext] = useState(SEED_NEXT)
  const [confirm, setConfirm] = useState(SEED_NEXT)
  const [currentError, setCurrentError] = useState<string | null>(null)
  const [nextError, setNextError] = useState<string | null>(null)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setCurrentError(null)
    const error = passwordFormError(current, next, confirm)
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
      setCurrent(SEED_CURRENT)
      setNext(SEED_NEXT)
      setConfirm(SEED_NEXT)
      markOnboarding('password')
      onChanged()
    } catch (err) {
      if (err instanceof ApiError && err.code === 'PASSWORD_MISMATCH') setCurrentError(err.message)
      else if (err instanceof ApiError && err.code === 'PASSWORD_UNCHANGED')
        setNextError(err.message)
      else onError(err instanceof ApiError ? err.message : '비밀번호를 바꾸지 못했습니다.')
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={submit} className={wide ? 'space-y-4' : 'max-w-sm space-y-4'}>
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
      <Button
        type="submit"
        size={wide ? 'md' : 'sm'}
        disabled={pending}
        className={wide ? 'w-full' : undefined}
      >
        {pending ? <Spinner className="border-t-on-accent" /> : submitLabel}
      </Button>
    </form>
  )
}
