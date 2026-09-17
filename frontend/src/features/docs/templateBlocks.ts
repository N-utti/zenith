import { escapeHtml, parseMarkdownTable, tableToHtml } from './markdownTable'

/**
 * `POST /ai/template` 이 돌려주는 블록을 편집기가 읽는 HTML 로 바꾼다.
 *
 * **블록 하나는 마크다운 한 덩이다**(04 §8 의 `{blocks[]}` 를 그렇게 가정했다, PR 본문). 서버가
 * HTML 을 주면 그대로 심어야 해서 위험하고, 편집기 JSON 을 주면 서버가 TipTap 스키마를 알아야
 * 한다. 마크다운은 사람이 읽을 수 있고 다른 클라이언트도 쓸 수 있다.
 *
 * 아는 모양만 바꾸고 나머지는 문단으로 둔다. 모르는 문법이 와도 글자가 사라지지 않는다.
 */
export function blocksToHtml(blocks: string[]): string {
  return blocks.map(blockToHtml).join('')
}

/** 계약에 없는 응답이라 모양을 믿지 않는다. 문자열 배열이 아니면 화면이 오류 문구로 간다. */
export function isBlockList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
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
