import { expect, it } from 'vitest'
import { cleanName, splitExt } from './format'

it('이름을 몸통과 확장자로 가른다', () => {
  expect(splitExt('보고서.pdf')).toEqual(['보고서', '.pdf'])
  expect(splitExt('a.tar.gz')).toEqual(['a.tar', '.gz'])
  // 확장자가 없거나 점으로 시작하는 이름은 가르지 않는다.
  expect(splitExt('README')).toEqual(['README', ''])
  expect(splitExt('.gitignore')).toEqual(['.gitignore', ''])
  // 마지막 점 뒤가 길면 확장자가 아니라 이름의 일부다.
  expect(splitExt('2026.하반기 제품 로드맵 최종본')).toEqual(['2026.하반기 제품 로드맵 최종본', ''])
})

// 끝의 점을 확장자로 보면 `.exe` 가 몸통에 들어가 말줄임에 가려진다. 저장하면 실행 파일이다.
it('끝에 붙은 점·공백 앞의 확장자를 놓치지 않는다', () => {
  expect(splitExt('a.exe.')).toEqual(['a', '.exe.'])
  expect(splitExt('a.exe. ')).toEqual(['a', '.exe. '])
})

it('숨은 글자를 걷는다. 글자 방향을 뒤집어 확장자를 속이는 이름을 막는다', () => {
  expect(cleanName('evil\u202Efdp.exe')).toBe('evilfdp.exe')
  expect(cleanName('a\u200Bb\u0000.txt')).toBe('ab.txt')
  expect(cleanName('계약서 최종.pdf')).toBe('계약서 최종.pdf')
})
