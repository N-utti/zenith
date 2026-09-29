import { escapeHtml, parseMarkdownTable, tableToHtml } from './markdownTable'

export type DocTemplate = 'minutes' | 'weekly' | 'notice'

/** 주간 보고 표의 빈 줄. 사람·팀이 더 많으면 표에서 줄을 늘린다. */
const WEEKLY_ROW = '|  |  |  |  |  |'

/**
 * 문서 템플릿. **블록 하나는 마크다운 한 덩이다.**
 *
 * 고정 문안이라 AI 서버(04 §8 `POST /ai/template`)를 거치지 않는다. 그 경로는 실서버에서 아직
 * 501 이라 템플릿이 통째로 안 됐다(PR 본문). 서버가 `context` 로 제목·참석자를 채우게 되면 그때 붙인다.
 */
export const TEMPLATE_BLOCKS: Record<DocTemplate, string[]> = {
  minutes: [
    '## 회의 개요',
    '- 일시:\n- 장소:\n- 참석:',
    '## 안건',
    '1. \n2. ',
    '## 결정 사항',
    '| 안건 | 결정 | 담당 |\n| --- | --- | --- |\n|  |  |  |',
    '## 다음 할 일',
    '- [ ] \n- [ ] ',
  ],
  // 사내에서 돌리던 엑셀(부서별 주간 업무 진행보고서)과 같은 칸이다. 한 문서를 모두가 같이 채운다.
  weekly: [
    '## 업무 현황',
    [
      '| 부서명 | 전주 진행 완료 사항 | 금주 진행 예정 사항 | 예정 완료 기한 | 요청사항 |',
      '| --- | --- | --- | --- | --- |',
      ...Array<string>(6).fill(WEEKLY_ROW),
    ].join('\n'),
  ],
  notice: ['## 공지 내용', '', '## 적용 시점', '- ', '## 문의', '- '],
}

/** 템플릿 블록을 편집기가 읽는 HTML 로 바꾼다. */
export function blocksToHtml(blocks: string[]): string {
  return blocks.map(blockToHtml).join('')
}

/**
 * 템플릿은 **빈 칸이 많다.** "- " 처럼 글머리만 있고 내용이 없는 줄이 정상이라, 뒤에 글자를
 * 요구하면 그 줄이 목록이 아니라 문단으로 떨어진다. 비어 있어도 목록으로 본다.
 */
const BULLET = /^-(?: (.*))?$/
const ORDERED = /^\d+\.(?: (.*))?$/
const TASK = /^- \[([ xX])\](?: (.*))?$/
const HEADING = /^(#{1,3}) (.+)$/

const lines = (block: string) =>
  block
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

const li = (text: string) => `<li><p>${escapeHtml(text)}</p></li>`

function blockToHtml(block: string): string {
  const rows = parseMarkdownTable(block)
  if (rows) return tableToHtml(rows)

  const items = lines(block)
  // 빈 블록은 "여기에 쓰라" 는 자리다. 지워 버리면 공지 템플릿에 본문 쓸 곳이 없어진다.
  if (items.length === 0) return '<p></p>'

  // 할 일 목록이 먼저다. `- [ ] 쓰기` 는 글머리 기호로도 읽히기 때문이다.
  const tasks = items.map((line) => TASK.exec(line))
  if (tasks.every((m) => m !== null)) {
    const rowsHtml = tasks
      .map((m) => {
        const done = m![1].toLowerCase() === 'x'
        // `data-type` 이 없으면 TipTap 의 할 일 항목으로 안 읽힌다. 글머리 목록으로 밀려나
        // 체크 상태를 잃고, 블록이 하나뿐이면 스키마가 안 맞아 삽입 자체가 예외로 죽는다.
        return `<li data-type="taskItem" data-checked="${done}"><p>${escapeHtml(m![2] ?? '')}</p></li>`
      })
      .join('')
    return `<ul data-type="taskList">${rowsHtml}</ul>`
  }

  const bullets = items.map((line) => BULLET.exec(line))
  if (bullets.every((m) => m !== null)) {
    return `<ul>${bullets.map((m) => li(m![1] ?? '')).join('')}</ul>`
  }

  const ordered = items.map((line) => ORDERED.exec(line))
  if (ordered.every((m) => m !== null)) {
    return `<ol>${ordered.map((m) => li(m![1] ?? '')).join('')}</ol>`
  }

  // 제목은 한 줄짜리만 본다. 여러 줄을 묶어 하나의 제목으로 만들지 않는다.
  if (items.length === 1) {
    const heading = HEADING.exec(items[0])
    if (heading) {
      // 문서 제목은 편집기 밖(문서 메타)에 있다. 본문 최상위는 h2 로 시작한다.
      // h4 는 편집기 스타일이 없어 문단과 구별이 안 되므로 h3 까지만 쓴다.
      const level = Math.min(heading[1].length + 1, 3)
      return `<h${level}>${escapeHtml(heading[2])}</h${level}>`
    }
  }

  return items.map((line) => `<p>${escapeHtml(line)}</p>`).join('')
}
