import { Link } from 'react-router'
import { ChevronRight, Circle, CircleCheck, X } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { dismissOnboarding, useOnboarding, type OnboardingStep } from './onboarding'

const STEPS: { step: OnboardingStep; label: string; description: string; to: string }[] = [
  {
    step: 'password',
    label: '비밀번호 바꾸기',
    description: '관리자가 정해 준 비밀번호를 나만 아는 것으로',
    to: '/settings',
  },
  {
    step: 'preferences',
    label: '알림 고르기',
    description: '받을 알림과 로그인하면 처음 열 화면',
    to: '/settings',
  },
  {
    step: 'chat',
    label: '채팅에 첫 메시지 남기기',
    description: '팀 채널에 인사 한마디',
    to: '/chat',
  },
  { step: 'ai', label: 'AI 에게 물어보기', description: '사내 문서를 근거로 답합니다', to: '/ai' },
]

/** 처음 온 사람의 할 일. 다 하거나 닫으면 사라진다(`onboarding`). */
export function OnboardingCard() {
  const state = useOnboarding()
  if (!state || state.dismissed) return null
  // 저장된 배열 길이가 아니라 지금 있는 할 일로 센다. 할 일을 바꿔도 카드가 일찍 사라지지 않는다.
  const doneCount = STEPS.filter(({ step }) => state.done.includes(step)).length
  if (doneCount === STEPS.length) return null

  return (
    <Card className="mt-7">
      <div className="flex items-center justify-between px-5 pt-4 pb-2">
        <h2 className="text-fg text-sm font-semibold">
          제니스 시작하기
          <span className="text-subtle ml-1.5 font-normal tabular-nums">
            {' '}
            <span aria-hidden>
              {doneCount}/{STEPS.length}
            </span>
            <span className="sr-only">
              {STEPS.length}개 중 {doneCount}개 끝남
            </span>
          </span>
        </h2>
        <button
          type="button"
          aria-label="시작하기 닫기"
          title="닫으면 이 기기에서는 다시 뜨지 않습니다"
          onClick={dismissOnboarding}
          className="text-subtle hover:text-fg hover:bg-surface-hover -mr-1.5 rounded-md p-1 transition-colors"
        >
          <X className="size-4" />
        </button>
      </div>
      <ul className="grid grid-cols-1 pb-2 sm:grid-cols-2">
        {STEPS.map(({ step, label, description, to }) => {
          const done = state.done.includes(step)
          const body = (
            <>
              {done ? (
                <CircleCheck role="img" aria-label="끝남" className="text-accent size-4 shrink-0" />
              ) : (
                <Circle className="text-subtle size-4 shrink-0" />
              )}
              <span className="min-w-0 flex-1">
                <span
                  className={'block text-[13px] ' + (done ? 'text-subtle line-through' : 'text-fg')}
                >
                  {label}
                </span>
                <span className="text-subtle block truncate text-xs">{description}</span>
              </span>
              {!done && <ChevronRight className="text-subtle size-4 shrink-0" />}
            </>
          )
          return (
            <li key={step}>
              {done ? (
                <div className="flex items-center gap-3 px-5 py-2.5">{body}</div>
              ) : (
                <Link
                  to={to}
                  className="hover:bg-surface-hover flex items-center gap-3 px-5 py-2.5 transition-colors"
                >
                  {body}
                </Link>
              )}
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
