import { strFromU8, unzipSync } from 'fflate'
import { expect, it } from 'vitest'
import { buildXlsx, colName, displayWidth } from './xlsx'

it('열 이름과 전각 폭', () => {
  expect([0, 25, 26, 27].map(colName)).toEqual(['A', 'Z', 'AA', 'AB'])
  expect(displayWidth('김철수')).toBe(6)
  expect(displayWidth('ab1')).toBe(3)
})

it('머리글·왼쪽 열을 고정하고 열 너비를 가장 긴 값에 맞춘다', () => {
  const zip = unzipSync(
    buildXlsx(
      [
        ['이름', '값'],
        ['홍길동 & <대리>', 12],
      ],
      { sheet: '2026-09', freezeCols: 1 },
    ),
  )
  const sheet = strFromU8(zip['xl/worksheets/sheet1.xml'])
  expect(sheet).toContain(
    '<pane xSplit="1" ySplit="1" topLeftCell="B2" activePane="bottomRight" state="frozen"/>',
  )
  // "홍길동 & <대리>" = 전각 5×2 + 반각 5 = 15, 여백 2. "값" = 2, 여백 2.
  expect(sheet).toContain('<col min="1" max="1" width="17" customWidth="1"/>')
  expect(sheet).toContain('<col min="2" max="2" width="4" customWidth="1"/>')
  expect(sheet).toContain('<c r="A1" s="1" t="inlineStr">')
  expect(sheet).toContain('홍길동 &amp; &lt;대리&gt;')
  expect(sheet).toContain('<c r="B2"><v>12</v></c>')
  expect(strFromU8(zip['xl/workbook.xml'])).toContain('name="2026-09"')
})
