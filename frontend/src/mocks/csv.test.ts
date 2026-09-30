import { describe, expect, it } from 'vitest'
import { decodeText, parseCsv } from './csv'

describe('CSV 읽기', () => {
  it('따옴표 안의 쉼표·줄바꿈·겹따옴표를 칸 하나로 읽는다', () => {
    expect(parseCsv('기관,메모\r\n"A, B","첫 줄\n둘째 ""줄"""\r\n\r\n')).toEqual([
      ['기관', '메모'],
      ['A, B', '첫 줄\n둘째 "줄"'],
      // 빈 행도 남긴다. 걸러 내면 그 아래 줄 번호가 엑셀과 어긋난다.
      [''],
      [''],
    ])
  })

  it('칸 중간의 따옴표는 글자로 보고, 짝 없는 감싸기 따옴표는 거절한다', () => {
    expect(parseCsv('홍"길동,a')).toEqual([['홍"길동', 'a']])
    expect(parseCsv('"열림,a\nb,c')).toBeNull()
  })

  it('UTF-8 BOM 을 떼고, UTF-8 이 아니면 CP949 로 읽는다', () => {
    expect(parseCsv(String.fromCharCode(0xfeff) + '기관')).toEqual([['기관']])
    // "기관" 의 CP949 바이트. 한글 윈도우 엑셀의 기본 CSV 저장이 이 인코딩이다.
    expect(decodeText(new Uint8Array([0xb1, 0xe2, 0xb0, 0xfc]))).toBe('기관')
    expect(decodeText(new TextEncoder().encode('기관'))).toBe('기관')
  })
})
