import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { Spinner } from '@/components/ui/Spinner'
import { useToast } from '@/components/ui/ToastContext'
import { ApiError } from '@/lib/api'
import { PASSWORD_MIN, ROLE_LABEL, type Role } from '@/types'
import { useCreateUser, useTeams, useUpdateUser } from './api'
import { userPatch, type UserForm } from './patch'
import { EMAIL_PATTERN, type AdminUser } from './types'

const ROLE_OPTIONS = (['member', 'lead', 'exec'] as Role[]).map((role) => ({
  value: role,
  label: ROLE_LABEL[role],
}))

/** 새 계정에만 있는 칸(이메일)을 더한 폼 상태. 고칠 때는 서버에 이메일을 바꾸는 길이 없다. */
interface Form extends UserForm {
  email: string
}

/**
 * 계정 하나를 만들거나 고친다. 두 경우가 칸을 거의 공유해서 한 폼으로 둔다.
 *
 * 다른 점은 셋이다. 이메일은 만들 때만 정한다(서버에 바꾸는 길이 없다). 비밀번호는 만들 때는
 * 필수고 고칠 때는 채운 경우에만 임시 비밀번호로 재설정한다. 활성 여부는 이미 있는 계정에만 있다.
 *
 * 열 때 마운트한다. 처음 값을 effect 로 다시 채우지 않게(`FolderNameModal` 과 같은 규약).
 */
export function UserModal({
  user,
  isSelf,
  onClose,
}: {
  /** 없으면 새 계정. */
  user?: AdminUser
  /** 내 계정이면 등급·활성 상태를 못 바꾼다. 서버도 `ADMIN_SELF` 로 막는다. */
  isSelf: boolean
  onClose: () => void
}) {
  const create = useCreateUser()
  const update = useUpdateUser()
  const teams = useTeams()
  const toast = useToast()
  const [form, setForm] = useState<Form>({
    name: user?.name ?? '',
    email: '',
    password: '',
    role: user?.role ?? 'member',
    teamId: user?.team_id ?? '',
    hireDate: user?.hire_date ?? '',
    active: user?.active ?? true,
  })
  const [error, setError] = useState<string | null>(null)

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
    setError(null)
  }

  // 목록이 오기 전에는 고르지 못하게 둔다. 지금 소속이 보기에 없는 채로 열어 두면
  // 건드리지 않아도 「팀 없음」이 골라진 것처럼 보인다.
  const teamOptions = [
    { value: '', label: '팀 없음' },
    ...(teams.data ?? []).map((team) => ({ value: team.id, label: team.name })),
  ]

  const pending = create.isPending || update.isPending
  const name = form.name.trim()
  const email = form.email.trim().toLowerCase()
  const patch = user ? userPatch(user, form) : null
  const emptyName = !name
  const ready =
    !emptyName &&
    (user
      ? Object.keys(patch ?? {}).length > 0
      : EMAIL_PATTERN.test(email) && form.password.length >= PASSWORD_MIN)
  const passwordTooShort = form.password.length > 0 && form.password.length < PASSWORD_MIN
  // 처음부터 빈 새 계정 폼에 대고 틀렸다고 말하지는 않는다. 채웠다가 지운 경우에만.
  const nameError = emptyName && (user || form.name !== '') ? '이름을 입력하세요.' : null

  const close = () => {
    // 보내는 중에 닫으면 성공·실패를 받을 곳이 사라진다. 끝난 뒤에 닫힌다.
    if (pending) return
    onClose()
  }

  const submit = () => {
    if (!ready || pending || passwordTooShort) return
    const fail = (err: unknown) =>
      setError(err instanceof ApiError ? err.message : '저장하지 못했습니다.')

    if (user && patch) {
      update.mutate(
        { id: user.id, patch },
        {
          onSuccess: () => {
            onClose()
            // 임시 비밀번호는 그 사람의 로그인을 전부 끊는다. 되돌릴 수 없는 일에는 말이 있어야 한다.
            if (patch.password) {
              toast.success(
                `${user.name} 님의 비밀번호를 임시 비밀번호로 바꿨습니다. 로그인은 모두 해제됩니다.`,
              )
            } else if (patch.active === false) {
              toast.success(`${user.name} 님의 계정을 비활성화했습니다.`)
            } else {
              toast.success('계정을 저장했습니다.')
            }
          },
          onError: fail,
        },
      )
      return
    }
    create.mutate(
      {
        name,
        email,
        password: form.password,
        role: form.role,
        team_id: form.teamId || null,
        hire_date: form.hireDate || null,
      },
      {
        onSuccess: (created) => {
          onClose()
          toast.success(`${created.name} 님의 계정을 만들었습니다.`)
        },
        onError: fail,
      },
    )
  }

  // 한글 조합 확정 Enter 는 거른다(폴더 이름·팔레트·작성창과 같은 규약).
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
    e.preventDefault()
    submit()
  }

  return (
    <Modal
      open
      onClose={close}
      title={user ? `${user.name} 계정` : '새 계정'}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={close} disabled={pending}>
            취소
          </Button>
          <Button size="sm" onClick={submit} disabled={!ready || pending || passwordTooShort}>
            {pending ? <Spinner className="border-t-on-accent" /> : user ? '저장' : '만들기'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="이름" required error={nameError}>
          {(slot) => (
            <Input
              {...slot}
              autoFocus
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              onKeyDown={onKeyDown}
              // 서버 상한(`Name`, 100자). 넘겨 보내면 Pydantic 422 라 화면에 사정이 안 남는다.
              maxLength={100}
              placeholder="예: 진수연"
            />
          )}
        </Field>

        {user ? (
          <Field label="이메일" hint="이메일은 바꿀 수 없습니다.">
            {/* `disabled` 는 안 쓴다. 탭에서 빠지면 키보드로는 이메일을 읽을 수도 없다. */}
            {(slot) => <Input {...slot} value={user.email} readOnly />}
          </Field>
        ) : (
          <Field label="이메일" required>
            {(slot) => (
              <Input
                {...slot}
                type="email"
                value={form.email}
                onChange={(e) => set('email', e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="예: suyeon@zenith.co.kr"
              />
            )}
          </Field>
        )}

        <Field
          label={user ? '임시 비밀번호' : '비밀번호'}
          required={!user}
          hint={
            user
              ? `채우면 임시 비밀번호로 바꾸고 그 사람의 로그인을 모두 해제합니다. ${PASSWORD_MIN}자 이상.`
              : `${PASSWORD_MIN}자 이상. 첫 로그인 뒤 본인이 설정에서 바꿉니다.`
          }
          error={passwordTooShort ? `${PASSWORD_MIN}자 이상이어야 합니다.` : null}
        >
          {(slot) => (
            <Input
              {...slot}
              type="password"
              autoComplete="new-password"
              value={form.password}
              onChange={(e) => set('password', e.target.value)}
              onKeyDown={onKeyDown}
              minLength={PASSWORD_MIN}
            />
          )}
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="등급" hint={isSelf ? '자기 등급은 바꿀 수 없습니다.' : undefined}>
            {(slot) => (
              <Select
                {...slot}
                options={ROLE_OPTIONS}
                value={form.role}
                disabled={isSelf}
                onChange={(e) => set('role', e.target.value as Role)}
              />
            )}
          </Field>

          <Field label="소속 팀" error={teams.isError ? '팀 목록을 불러오지 못했습니다.' : null}>
            {(slot) => (
              <Select
                {...slot}
                options={teamOptions}
                value={form.teamId}
                disabled={teams.isPending || teams.isError}
                onChange={(e) => set('teamId', e.target.value)}
              />
            )}
          </Field>

          <Field label="입사일" hint="연차 계산 기준입니다.">
            {(slot) => (
              <Input
                {...slot}
                type="date"
                value={form.hireDate}
                onChange={(e) => set('hireDate', e.target.value)}
              />
            )}
          </Field>
        </div>

        {user && (
          <Checkbox
            checked={form.active}
            disabled={isSelf}
            onChange={(e) => set('active', e.target.checked)}
            label="계정 활성"
            description={
              isSelf
                ? '자기 계정은 비활성화할 수 없습니다.'
                : '끄면 로그인을 막고 열려 있던 세션을 모두 닫습니다.'
            }
          />
        )}

        {error && (
          <p role="alert" className="text-danger text-xs">
            {error}
          </p>
        )}
      </div>
    </Modal>
  )
}
