import { Moon, Sun } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { Field } from '@/components/ui/Field'
import { Select } from '@/components/ui/Select'
import { Spinner } from '@/components/ui/Spinner'
import { useToast } from '@/components/ui/ToastContext'
import { DelegationSection } from '@/features/approvals/DelegationSection'
import { useCurrentUser } from '@/features/auth/AuthContext'
import { PasswordForm } from '@/features/auth/PasswordForm'
import { markOnboarding } from '@/features/home/onboarding'
import {
  START_PAGES,
  usePreferences,
  useUpdatePreferences,
  type NotificationKind,
  type PreferencesPatch,
  type StartPage,
} from '@/features/settings/preferences'
import { ApiError } from '@/lib/api'
import { hueOf } from '@/lib/avatar'
import { setContentWide, useContentWide } from '@/lib/contentWidth'
import { useTheme } from '@/lib/theme'
import { ROLE_LABEL } from '@/types'

function PasswordSection() {
  const toast = useToast()
  return (
    <section className="border-line bg-surface mt-4 rounded-xl border p-6">
      <h2 className="text-fg mb-1 text-sm font-semibold">비밀번호</h2>
      <p className="text-muted mb-4 text-sm">
        바꾸면 지금 쓰는 기기만 남고 다른 기기는 다시 로그인해야 합니다.
      </p>
      <PasswordForm
        submitLabel="비밀번호 변경"
        // 서버가 이 세션만 남기고 나머지를 끊는다(backend/README §1 확장). 다른 기기에서 놀라지 않게 알린다.
        onChanged={() =>
          toast.success('비밀번호를 바꿨습니다. 다른 기기의 로그인은 모두 해제됩니다.')
        }
        onError={toast.error}
      />
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
      onSuccess: () => markOnboarding('preferences'),
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
