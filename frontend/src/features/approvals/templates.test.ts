import { expect, it } from 'vitest'
import {
  composeBody,
  filledFields,
  switchTemplate,
  templateContent,
  templateOf,
  titleOf,
} from './templates'

const blank = { title: '', body: '', values: {} }

it('제목은 머리말만 바뀌고 뒤에 쓴 말은 남는다', () => {
  expect(switchTemplate('expense', blank)).toEqual({ title: '[지출결의] ', overwrites: false })
  expect(switchTemplate('purchase', { ...blank, title: '[지출결의] 모니터' }).title).toBe(
    '[구매요청] 모니터',
  )
  // 머리말 뒤 공백을 지웠어도 겹쳐 붙지 않는다.
  expect(switchTemplate('proposal', { ...blank, title: '[지출결의]모니터' }).title).toBe(
    '[품의] 모니터',
  )
  expect(switchTemplate('general', { ...blank, title: '[품의] 모니터' }).title).toBe('모니터')
})

it('본문이든 칸이든 써 둔 게 있으면 지우기 전에 물어야 한다', () => {
  expect(switchTemplate('expense', { ...blank, body: '메모' }).overwrites).toBe(true)
  expect(switchTemplate('general', { ...blank, values: { purpose: '택시비' } }).overwrites).toBe(
    true,
  )
  // 골랐다가 비운 칸은 쓴 게 아니다.
  expect(switchTemplate('general', { ...blank, values: { purpose: ' ' } }).overwrites).toBe(false)
})

it('머리말만 있는 제목은 안 쓴 칸이고, 내용은 필수 칸이 다 차야 찬 것이다', () => {
  const required = {
    date: '2026-10-01',
    method: '법인카드',
    items: '- 12,000원',
  }
  expect(filledFields('expense', { ...blank, title: '[지출결의] ' })).toEqual({
    title: false,
    body: false,
  })
  // 필수 칸 하나가 공백이면 안 찬 것이다.
  expect(
    filledFields('expense', { title: '[지출결의] 택시비', body: '', values: required }),
  ).toEqual({ title: true, body: true })
  expect(filledFields('expense', { ...blank, values: { ...required, items: ' ' } }).body).toBe(
    false,
  )
  // 기안서는 칸이 없어 본문을 본다.
  expect(filledFields('general', { title: ' ', body: '', values: {} })).toEqual({
    title: false,
    body: false,
  })
  expect(filledFields('general', { ...blank, body: '본문' }).body).toBe(true)
})

it('칸의 값을 본문 글로 푼다. 빈 칸은 빠지고 여러 줄 칸은 라벨 아래로 내려간다', () => {
  expect(
    composeBody('expense', {
      date: '2026-10-01',
      method: '법인카드',
      items: '- 야근 택시 12,000원\n- 주차 3,000원',
    }),
  ).toBe(
    '지출 일자: 2026-10-01\n결제 방법: 법인카드\n\n지출 내역:\n- 야근 택시 12,000원\n- 주차 3,000원',
  )
  // 비운 칸은 빠진다.
  expect(composeBody('certificate', { kind: '재직증명서', copies: '1부', purpose: ' ' })).toBe(
    '증명서 종류: 재직증명서\n부수: 1부',
  )
  // 여러 줄 칸이 이어져도 빈 줄은 하나다.
  expect(composeBody('proposal', { reason: '노후', content: '교체' })).toBe(
    '품의 사유:\n노후\n\n품의 내용:\n교체',
  )
  // 적은 글 속의 빈 줄은 그대로 둔다.
  expect(composeBody('proposal', { reason: '가\n\n\n나' })).toBe('품의 사유:\n가\n\n\n나')
  expect(composeBody('general', {})).toBe('')
})

it('저장할 내용: 기안서는 본문만 보내고, 칸이 있는 서식은 지금 서식의 칸만 담는다', () => {
  // 칸 값이 남아 있어도 기안서는 `extra` 키 자체를 안 보낸다.
  expect(templateContent('general', { body: '본문', values: { purpose: '남은 값' } })).toEqual({
    body: '본문',
  })
  expect(
    templateContent('trip', {
      body: '안 쓰는 본문',
      values: { period: '2026-09-22', purpose: '거래처 방문', gone: '옛 칸' },
    }),
  ).toEqual({
    body: '출장 기간: 2026-09-22\n출장 목적: 거래처 방문',
    extra: {
      form: 'trip',
      fields: { period: '2026-09-22', purpose: '거래처 방문', method: '', items: '' },
    },
  })
})

it('증명서는 적은 제목 대신 종류·부수로 제목을 만든다', () => {
  const values = { kind: '재직증명서', copies: '2부' }
  expect(titleOf('certificate', '[증명서] 아무 말', values)).toBe('[증명서] 재직증명서 2부')
  // 아직 안 골랐으면 머리말만 남아 안 쓴 제목이 된다.
  expect(
    filledFields('certificate', { ...blank, title: titleOf('certificate', '', {}) }).title,
  ).toBe(false)
  // 다른 서식은 적은 제목 그대로다.
  expect(titleOf('expense', '[지출결의] 택시비', values)).toBe('[지출결의] 택시비')
})

it('모르는 서식 이름은 기안서로 연다', () => {
  expect(templateOf('purchase')).toBe('purchase')
  expect(templateOf(undefined)).toBe('general')
  expect(templateOf('leave-form')).toBe('general')
  // 객체가 물려받은 이름에 속지 않는다.
  expect(templateOf('toString')).toBe('general')
})
