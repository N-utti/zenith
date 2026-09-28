import { expect, it } from 'vitest'
import { APPROVAL_TEMPLATES, filledFields, switchTemplate } from './templates'

it('빈 폼에서 고르면 머리말과 본문 틀이 채워진다', () => {
  expect(switchTemplate('general', 'expense', { title: '', body: '' })).toEqual({
    title: '[지출결의] ',
    body: APPROVAL_TEMPLATES.expense.body,
    overwrites: false,
  })
})

it('제목은 머리말만 바뀌고 뒤에 쓴 말은 남는다', () => {
  const next = switchTemplate('expense', 'purchase', {
    title: '[지출결의] 모니터',
    body: APPROVAL_TEMPLATES.expense.body,
  })
  expect(next.title).toBe('[구매요청] 모니터')
  // 틀 그대로면 덮어도 잃을 게 없다.
  expect(next.overwrites).toBe(false)
  // 머리말 뒤 공백을 지웠어도 겹쳐 붙지 않는다.
  expect(switchTemplate('expense', 'proposal', { title: '[지출결의]모니터', body: '' }).title).toBe(
    '[품의] 모니터',
  )
  expect(switchTemplate('proposal', 'general', { title: '[품의] 모니터', body: '' }).title).toBe(
    '모니터',
  )
})

it('본문을 고쳐 썼으면 덮기 전에 물어야 한다', () => {
  const edited = APPROVAL_TEMPLATES.expense.body + '택시비 12,000원'
  expect(switchTemplate('expense', 'general', { title: '', body: edited }).overwrites).toBe(true)
  expect(switchTemplate('general', 'proposal', { title: '', body: '메모' }).overwrites).toBe(true)
})

it('머리말만 있는 제목, 틀 그대로인 본문은 안 쓴 칸이다', () => {
  const blank = { title: '[지출결의] ', body: APPROVAL_TEMPLATES.expense.body }
  expect(filledFields('expense', blank)).toEqual({ title: false, body: false })
  expect(
    filledFields('expense', { title: '[지출결의] 택시비', body: blank.body + '12,000원' }),
  ).toEqual({ title: true, body: true })
  expect(filledFields('general', { title: ' ', body: '' })).toEqual({ title: false, body: false })
})
