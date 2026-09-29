import { describe, expect, it } from 'vitest'
import { blocksToHtml, TEMPLATE_BLOCKS } from './templateBlocks'

describe('blocksToHtml', () => {
  it('제목·문단·목록·표를 편집기 노드로 바꾼다', () => {
    const html = blocksToHtml([
      '## 안건',
      '- 배포 일정\n- 장애 회고',
      '1. 먼저\n2. 다음',
      '| 항목 | 담당 |\n| --- | --- |\n| 배포 | 정성운 |',
      '보통 문장.',
    ])
    expect(html).toBe(
      '<h3>안건</h3>' +
        '<ul><li><p>배포 일정</p></li><li><p>장애 회고</p></li></ul>' +
        '<ol><li><p>먼저</p></li><li><p>다음</p></li></ol>' +
        '<table><tbody><tr><th>항목</th><th>담당</th></tr><tr><td>배포</td><td>정성운</td></tr></tbody></table>' +
        '<p>보통 문장.</p>',
    )
  })

  it('할 일은 TipTap 이 읽는 표시를 달고 체크 상태를 살린다', () => {
    /*
     * `data-type` 이 빠지면 TipTap 이 평범한 목록 항목으로 읽어 할 일 목록 밖으로 밀어낸다.
     * 체크 상태가 사라지고, 블록이 하나뿐이면 스키마가 안 맞아 삽입이 예외로 죽는다.
     */
    expect(blocksToHtml(['- [ ] 초안 쓰기\n- [X] 회의실 예약'])).toBe(
      '<ul data-type="taskList">' +
        '<li data-type="taskItem" data-checked="false"><p>초안 쓰기</p></li>' +
        '<li data-type="taskItem" data-checked="true"><p>회의실 예약</p></li>' +
        '</ul>',
    )
  })

  it('할 일 목록을 글머리 기호로 오해하지 않는다', () => {
    // `- [ ] 쓰기` 는 글머리로도 읽힌다. 할 일이 먼저 걸려야 체크칸이 생긴다.
    expect(blocksToHtml(['- [ ] 쓰기'])).toContain('data-type="taskList"')
  })

  it('모르는 문법이 와도 글자가 사라지지 않는다', () => {
    // 서버가 새 문법을 쓰더라도 내용이 통째로 없어지면 안 된다.
    expect(blocksToHtml(['> 인용문']).includes('인용문')).toBe(true)
  })

  it('빈 블록은 쓸 자리로 남긴다', () => {
    // 공지 템플릿의 본문 자리가 이 모양이다. 지워 버리면 제목만 줄줄이 남는다.
    expect(blocksToHtml(['## 공지 내용', ''])).toBe('<h3>공지 내용</h3><p></p>')
  })

  it('제목은 h3 까지만 만든다', () => {
    // h4 는 편집기 스타일이 없어 문단과 구별이 안 된다.
    expect(blocksToHtml(['# 하나', '## 둘', '### 셋'])).toBe('<h2>하나</h2><h3>둘</h3><h3>셋</h3>')
  })

  it('제목과 목록이 한 블록에 섞여 오면 글자로 남긴다', () => {
    // 블록 하나가 마크다운 한 덩이라는 가정이 깨진 경우다. 틀리게 꾸미느니 그대로 보인다.
    expect(blocksToHtml(['## 안건\n- 하나'])).toBe('<p>## 안건</p><p>- 하나</p>')
  })
})

describe('편집기에 심기 전 이스케이프', () => {
  it('꺾쇠를 그대로 넣지 않는다', () => {
    // 초안은 AI 가 만든 글이다. 편집기에 HTML 로 심으므로 태그로 읽히면 안 된다.
    expect(blocksToHtml(['<img src=x onerror=alert(1)>'])).toBe(
      '<p>&lt;img src=x onerror=alert(1)&gt;</p>',
    )
  })

  it('이미 이스케이프된 글자를 되살리지 않는다', () => {
    /*
     * `&` 를 안 막으면 `&lt;script&gt;` 가 브라우저에서 진짜 태그로 되살아난다. 미리보기가
     * 이 HTML 을 그대로 그리므로 여기가 마지막 방어선이다.
     */
    expect(blocksToHtml(['&lt;script&gt;alert(1)&lt;/script&gt;'])).toBe(
      '<p>&amp;lt;script&amp;gt;alert(1)&amp;lt;/script&amp;gt;</p>',
    )
  })

  it('표 셀도 같은 규칙을 탄다', () => {
    expect(blocksToHtml(['| a | b |\n| --- | --- |\n| <b> | &amp; |'])).toContain(
      '<td>&lt;b&gt;</td><td>&amp;amp;</td>',
    )
  })
})

describe('TEMPLATE_BLOCKS', () => {
  it('주간 보고는 사내 엑셀과 같은 칸의 표가 된다', () => {
    const html = blocksToHtml(TEMPLATE_BLOCKS.weekly)
    expect(html).toContain(
      '<tr><th>부서명</th><th>전주 진행 완료 사항</th><th>금주 진행 예정 사항</th>' +
        '<th>예정 완료 기한</th><th>요청사항</th></tr>',
    )
    // 빈 줄이 표 행으로 살아야 채울 자리가 있다. 문단으로 떨어지면 "|" 글자만 남는다.
    expect(html.match(/<tr>/g)).toHaveLength(7)
  })
})
