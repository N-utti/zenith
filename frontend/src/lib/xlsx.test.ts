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

it('금액 열은 천 단위 쉼표 서식이고 열 너비도 쉼표 모양으로 잰다', () => {
  const zip = unzipSync(buildXlsx([['금액(원)'], [120_000_000_000]], { integerCols: [0] }))
  const sheet = strFromU8(zip['xl/worksheets/sheet1.xml'])
  expect(sheet).toContain('<c r="A2" s="2"><v>120000000000</v></c>')
  // "120,000,000,000" = 15, 여백 2.
  expect(sheet).toContain('<col min="1" max="1" width="17" customWidth="1"/>')
  expect(strFromU8(zip['xl/styles.xml'])).toContain('<xf numFmtId="3"')
})

it('= 로 시작하는 글자도 수식이 아니라 글자로 들어간다 (TC-CRM-SEC-06)', () => {
  const zip = unzipSync(buildXlsx([['메모'], ['=HYPERLINK("http://x","열기")']]))
  const sheet = strFromU8(zip['xl/worksheets/sheet1.xml'])
  expect(sheet).not.toContain('<f>')
  expect(sheet).toContain('<c r="A2" t="inlineStr"><is><t xml:space="preserve">=HYPERLINK(')
})
