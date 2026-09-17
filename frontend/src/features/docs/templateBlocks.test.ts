import { describe, expect, it } from 'vitest'
import { blocksToHtml } from './templateBlocks'

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

  it('할 일 목록은 체크 상태를 살린다', () => {
    expect(blocksToHtml(['- [ ] 초안 쓰기\n- [x] 회의실 예약'])).toBe(
      '<ul data-type="taskList">' +
        '<li data-checked="false"><p>초안 쓰기</p></li>' +
        '<li data-checked="true"><p>회의실 예약</p></li>' +
        '</ul>',
    )
  })

  it('모르는 문법이 와도 글자가 사라지지 않는다', () => {
    // 서버가 새 문법을 쓰더라도 내용이 통째로 없어지면 안 된다.
    expect(blocksToHtml(['> 인용문', '']).includes('인용문')).toBe(true)
  })

  it('꺾쇠를 그대로 넣지 않는다', () => {
    // 초안은 AI 가 만든 글이다. 편집기에 HTML 로 심으므로 태그로 읽히면 안 된다.
    expect(blocksToHtml(['<img src=x onerror=alert(1)>'])).toBe(
      '<p>&lt;img src=x onerror=alert(1)&gt;</p>',
    )
  })
})

describe('빈 칸이 많은 템플릿', () => {
  it('글머리만 있고 내용이 없어도 목록이다', () => {
    // 템플릿은 채워 넣으라고 주는 뼈대다. 빈 줄이 문단으로 떨어지면 목록이 아니라 "-" 글자가 남는다.
    expect(blocksToHtml(['- \n- '])).toBe('<ul><li><p></p></li><li><p></p></li></ul>')
    expect(blocksToHtml(['1. \n2. '])).toBe('<ol><li><p></p></li><li><p></p></li></ol>')
    expect(blocksToHtml(['- [ ] \n- [ ] '])).toBe(
      '<ul data-type="taskList"><li data-checked="false"><p></p></li>' +
        '<li data-checked="false"><p></p></li></ul>',
    )
  })

  it('할 일 목록을 글머리 기호로 오해하지 않는다', () => {
    // `- [ ] 쓰기` 는 글머리로도 읽힌다. 할 일이 먼저 걸려야 체크칸이 생긴다.
    expect(blocksToHtml(['- [ ] 쓰기'])).toContain('data-type="taskList"')
  })
})
