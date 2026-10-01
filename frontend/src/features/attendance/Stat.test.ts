import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import { Stat } from './Stat'

function draw(props: Parameters<typeof Stat>[0]) {
  const box = document.createElement('div')
  box.innerHTML = renderToStaticMarkup(createElement(Stat, props))
  const value = box.querySelector('dd')!
  return {
    text: value.textContent,
    units: [...value.querySelectorAll('span')].map((span) => span.textContent),
  }
}

test('단위가 값에 섞여 온 글자열은 숫자만 크게 두고 나머지를 단위로 그린다', () => {
  expect(draw({ label: '연장근로', value: '1시간 30분', unit: '' })).toEqual({
    text: '1시간 30분',
    units: ['시간 ', '분'],
  })
  // 숫자로 시작해도 앞에 빈 단위가 생기지 않는다. 생기면 여백만큼 숫자가 밀린다.
  expect(draw({ label: '연장근로', value: '0시간', unit: '' }).units).toEqual(['시간'])
})

test('숫자 값은 그대로 두고 뒤에 단위를 붙인다', () => {
  expect(draw({ label: '잔여', value: 12.5 })).toEqual({ text: '12.5일', units: ['일'] })
})
