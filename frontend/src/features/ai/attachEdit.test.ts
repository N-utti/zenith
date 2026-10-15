import { expect, test } from 'vitest'
import { canEdit, isFormula } from './attachEdit'

test('엑셀·워드만 고칠 수 있다', () => {
  expect(canEdit('매출.xlsx')).toBe(true)
  expect(canEdit('보고서.DOCX')).toBe(true)
  expect(canEdit('표.csv')).toBe(false)
  expect(canEdit('xlsx')).toBe(false)
})

test('엑셀에서 = 로 시작하는 값만 수식이다', () => {
  expect(isFormula('매출.xlsx', '=SUM(B2:B6)')).toBe(true)
  expect(isFormula('매출.xlsx', ' =1')).toBe(false)
  expect(isFormula('매출.xlsx', '1200')).toBe(false)
  expect(isFormula('보고서.docx', '=SUM(B2:B6)')).toBe(false)
})
