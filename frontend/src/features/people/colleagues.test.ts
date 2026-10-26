import { expect, it } from 'vitest'
import { byTier, pickable, type Colleague } from './colleagues'

const person = (id: string, name: string, active: boolean, role = 'member'): Colleague => ({
  id,
  name,
  active,
  role,
  team: null,
})

const people: Colleague[] = [
  person('u-1', '진수연', true),
  person('u-2', '정성운', true),
  person('u-9', '퇴사자', false),
]

it('자기 자신과 비활성 계정은 고를 수 없다', () => {
  expect(pickable(people, 'u-1').map((p) => p.id)).toEqual(['u-2'])
  // 비활성을 남기면 고를 수 있게 보이고, 보낸 뒤에야 422 로 알게 된다.
  expect(pickable(people, 'u-2').some((p) => p.id === 'u-9')).toBe(false)
})

it('서버가 준 순서를 그대로 둔다. 이름순은 서버가 정한다', () => {
  expect(pickable(people, 'x').map((p) => p.name)).toEqual(['진수연', '정성운'])
})

it('임원·사원으로 가른다', () => {
  const tiered = [
    person('a', '가', true),
    person('b', '나', true, 'exec'),
    person('c', '다', true, 'lead'),
  ]
  expect(byTier(tiered)).toEqual([
    { label: '임원', people: [tiered[1]] },
    // 등급은 두 단이다. 죽은 lead 는 사원 쪽.
    { label: '사원', people: [tiered[0], tiered[2]] },
  ])
})

it('없는 쪽 묶음은 뺀다. 임원이 없으면 사원 줄 하나', () => {
  expect(byTier(people)).toEqual([{ label: '사원', people }])
})
