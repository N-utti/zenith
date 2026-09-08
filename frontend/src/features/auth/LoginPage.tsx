import { useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { Spinner } from '@/components/ui/Spinner'
import { ZenithMark } from '@/components/ui/ZenithMark'
import { ApiError } from '@/lib/api'
import { DEMO_ACCOUNTS, MSW_ENABLED } from '@/mocks/accounts'
import { useAuth } from './AuthContext'

export function LoginPage() {
  const { status, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  if (status === 'authenticated') return <Navigate to="/" replace />

  const from = (location.state as { from?: string } | null)?.from ?? '/'

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setPending(true)
    try {
      await login(email, password)
      await navigate(from, { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '로그인 중 오류가 발생했습니다.')
    } finally {
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
