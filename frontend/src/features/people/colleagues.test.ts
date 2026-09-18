import { expect, it } from 'vitest'
import { pickable, type Colleague } from './colleagues'

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
