import { useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { Spinner } from '@/components/ui/Spinner'
import { ZenithMark } from '@/components/ui/ZenithMark'
import { ApiError } from '@/lib/api'
import { DEMO_ACCOUNTS, MSW_ENABLED } from '@/mocks/accounts'
import { fetchPreferences } from '@/features/settings/preferences'
import { useAuth } from './AuthContext'

export function LoginPage() {
  const { status, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  // 이미 로그인한 채 이 주소로 온 경우만. 방금 제출한 로그인은 `login()` 이 프로필을 채우는 순간
  // 여기가 먼저 홈으로 보내 버려서, 시작 화면을 고르는 `submit` 이 끝날 때까지 비켜 둔다.
  if (status === 'authenticated' && !pending) return <Navigate to="/" replace />

  // 보호된 주소로 들어오다 튕긴 거면 그 자리로 돌려보낸다. 그냥 로그인했을 때만 시작 화면을 쓴다.
  // 주소창에 도메인만 치고 들어오면 `RequireAuth` 가 `/` 를 실어 보낸다. 그건 "그냥 로그인" 이다.
  const state = (location.state as { from?: string } | null)?.from
  const from = state && state !== '/' ? state : undefined

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setPending(true)
    try {
      await login(email, password)
      // 설정을 못 읽어도 로그인은 된 것이다. 홈으로 보낸다.
      const to = from ?? (await fetchPreferences().catch(() => null))?.start_page ?? '/'
      await navigate(to, { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '로그인 중 오류가 발생했습니다.')
      // 성공했을 때는 풀지 않는다. 라우터는 주소 이동을 transition 으로 늦게 그리는데, 그 사이에
      // 이게 먼저 풀리면 위의 `<Navigate to="/">` 가 이동을 덮어써서 늘 홈으로 간다.
      setPending(false)
    }
  }

  return (
    <div className="bg-canvas grid h-full place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <ZenithMark className="mx-auto mb-3 size-11" />
          <h1 className="text-fg text-xl font-semibold tracking-tight">제니스에 로그인</h1>
          <p className="text-muted mt-1 text-sm">사내 계정으로 로그인하세요.</p>
        </div>

        <form
          onSubmit={submit}
          className="border-line bg-surface space-y-4 rounded-xl border p-6 shadow-sm"
        >
          <Field label="이메일" required>
            {(slot) => (
              <Input
                {...slot}
                type="email"
                required
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.co.kr"
              />
            )}
          </Field>

          {/* 비밀번호 오류는 어느 칸이 틀렸는지 알려 주지 않는다. 폼 전체 에러로 둔다. */}
          <Field label="비밀번호" required error={error}>
            {(slot) => (
              <Input
                {...slot}
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
          </Field>

          <Button type="submit" disabled={pending} className="w-full">
            {pending ? <Spinner className="border-t-on-accent" /> : '로그인'}
          </Button>
        </form>

        {MSW_ENABLED && (
          <div className="border-line bg-surface mt-4 rounded-xl border p-4">
            <p className="text-subtle mb-2 text-xs font-semibold">
              목(mock) 계정. 비밀번호 <code className="font-mono">zenith1234</code>
            </p>
            <div className="space-y-1">
              {DEMO_ACCOUNTS.map((account) => (
                <button
                  key={account.email}
                  type="button"
                  onClick={() => {
                    setEmail(account.email)
                    setPassword('zenith1234')
                  }}
                  className="text-muted hover:bg-surface-hover hover:text-fg flex w-full cursor-pointer items-center justify-between rounded-lg px-2.5 py-1.5 text-sm"
                >
                  <span>{account.label}</span>
                  <span className="text-subtle font-mono text-xs">{account.email}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
