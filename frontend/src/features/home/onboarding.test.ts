import { describe, expect, it } from 'vitest'
import { dismissOnboarding, markOnboarding, setOnboardingOwner } from './onboarding'

const saved = (id: string) => JSON.parse(localStorage.getItem(`zenith.onboarding.${id}`) ?? 'null')

describe('시작하기 진행 상태', () => {
  it('로그인 전에는 남기지 않고, 사람마다 따로 남는다', () => {
    setOnboardingOwner(null)
    markOnboarding('chat')

    setOnboardingOwner('a')
    expect(saved('a')).toBeNull()
    markOnboarding('password')
    markOnboarding('password')
    expect(saved('a')).toEqual({ done: ['password'], dismissed: false })

    setOnboardingOwner('b')
    markOnboarding('ai')
    dismissOnboarding()
    expect(saved('b')).toEqual({ done: ['ai'], dismissed: true })

    // 다시 들어온 a 는 자기 것을 이어 받는다.
    setOnboardingOwner('a')
    markOnboarding('chat')
    expect(saved('a')).toEqual({ done: ['password', 'chat'], dismissed: false })

    // 다른 탭이 그사이 남긴 것을 덮어쓰지 않는다.
    localStorage.setItem(
      'zenith.onboarding.a',
      JSON.stringify({ done: ['password', 'chat', 'ai'], dismissed: false }),
    )
    markOnboarding('preferences')
    expect(saved('a').done).toEqual(['password', 'chat', 'ai', 'preferences'])
  })
})
