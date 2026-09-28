import { expect, it } from 'vitest'
import { byTier, pickable, type Colleague } from './colleagues'

const people: Colleague[] = [
  { id: 'u-1', name: '진수연', active: true },
  { id: 'u-2', name: '정성운', active: true },
  { id: 'u-9', name: '퇴사자', active: false },
]

it('자기 자신과 비활성 계정은 고를 수 없다', () => {
  expect(pickable(people, 'u-1').map((p) => p.id)).toEqual(['u-2'])
  // 비활성을 남기면 고를 수 있게 보이고, 보낸 뒤에야 422 로 알게 된다.
  expect(pickable(people, 'u-2').some((p) => p.id === 'u-9')).toBe(false)
})

it('서버가 준 순서를 그대로 둔다. 이름순은 서버가 정한다', () => {
  expect(pickable(people, 'x').map((p) => p.name)).toEqual(['진수연', '정성운'])
})

it('임원·사원으로 가른다. 등급이 없으면 가르지 않는다', () => {
  expect(byTier(people)).toBeNull()
  const tiered: Colleague[] = [
    { id: 'a', name: '가', active: true, role: 'member' },
    { id: 'b', name: '나', active: true, role: 'exec' },
    { id: 'c', name: '다', active: true, role: 'lead' },
  ]
  expect(byTier(tiered)).toEqual([
    { label: '임원', people: [tiered[1]] },
    // 등급은 두 단이다. 죽은 lead 는 사원 쪽.
    { label: '사원', people: [tiered[0], tiered[2]] },
  ])
})
