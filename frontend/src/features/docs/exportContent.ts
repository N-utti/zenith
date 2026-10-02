import type { JSONContent } from '@tiptap/core'
import { cleanName } from '@/lib/format'
import { displayWidth } from '@/lib/xlsx'

/** 파일 안에 넣을 사진 한 장. 워드가 읽는 형식(png·jpeg·gif)으로 맞춰 둔 것이다. */
export interface ExportImage {
  bytes: Uint8Array
  ext: 'png' | 'jpeg' | 'gif'
  /** 원본 크기(px). 문서에 폭이 따로 없으면 이 크기로 넣는다. */
  width: number
  height: number
}

/** 변환기가 받는 것. 본문은 편집기의 JSON 그대로다. */
export interface ExportSource {
  title: string
  doc: JSONContent
  /** 사진 블록의 `src` 로 찾는다. 여기 없는 사진은 받아 오지 못한 것이다. */
  images: Map<string, ExportImage>
  /** 서버 주소. 파일 칩의 상대경로를 문서 밖에서도 열리는 주소로 바꾼다. */
  origin: string
}

/** 본문에 든 사진의 `src` 를 겹치지 않게 모은다. */
export function imageSources(doc: JSONContent): string[] {
  const found = new Set<string>()
  const walk = (node: JSONContent) => {
    if (node.type === 'imageBlock' && typeof node.attrs?.src === 'string') found.add(node.attrs.src)
    node.content?.forEach(walk)
  }
  walk(doc)
  return [...found]
}

/**
 * 파일에 링크로 실어도 되는 주소면 정돈해서, 아니면 `null`.
 *
 * 링크는 남의 편집(Y.Doc)에서도 온다. `javascript:`·`file:` 같은 것을 문서 파일에 옮겨 심지 않는다.
 * 주소로 읽히지 않는 글자는 워드가 파일째 «손상됨» 으로 거부하므로 그것도 여기서 거른다.
 */
export function safeHref(href: unknown): string | null {
  if (typeof href !== 'string') return null
  try {
    const url = new URL(href)
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.href
    // 메일·전화 주소는 `URL` 이 정돈해 주지 않는다. 공백·따옴표가 든 것은 주소가 아니라고 본다.
    const plain = url.protocol === 'mailto:' || url.protocol === 'tel:'
    return plain && !/[\s"<>]/.test(url.href) ? url.href : null
  } catch {
    return null
  }
}

/** 색을 `RRGGBB` 로. 편집기 팔레트는 `#rrggbb` 지만 붙여넣은 글에는 `rgb()` 도 온다. 못 읽으면 `null`. */
export function hexColor(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim())?.[1]
  if (hex) return (hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex).toUpperCase()
  const rgb = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(value.trim())
  if (!rgb) return null
  return rgb
    .slice(1)
    .map((n) => Math.min(255, Number(n)).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()
}

/** 표에 놓인 칸 하나. 합친 칸이 위에서 내려와 차지한 자리는 `node` 가 `null` 이다. */
export interface PlacedCell {
  node: JSONContent | null
  col: number
  colspan: number
  rowspan: number
}

export const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)

/**
 * 문서 속성을 `min`~`max` 의 정수로. 못 읽으면 1.
 *
 * 속성은 남의 편집(Y.Doc)에서도 온다. 소수·무한대가 그대로 파일에 실리면 워드가 파일을 거부하고,
 * 무한대 칸 합치기는 반복문을 끝내지 못한다.
 */
export function wholeNumber(value: unknown, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(Number(value)) || 1))
}

/** 칸 합치기 수. 워드의 표는 63열까지다. */
const span = (value: unknown) => wholeNumber(value, 1, 63)

/** 칸에서 가장 긴 줄의 길이(한글은 두 칸). 줄은 문단과 줄바꿈으로 갈린다. */
function longestLine(cell: JSONContent): number {
  let longest = 0
  for (const block of cell.content ?? []) {
    let line = 0
    for (const inline of block.content ?? []) {
      if (inline.type === 'hardBreak') line = 0
      else line += displayWidth(inline.text ?? String(inline.attrs?.name ?? ''))
      longest = Math.max(longest, line)
    }
  }
  return longest
}

/** 표의 열 하나. */
export interface TableColumn {
  /** 문서에 적힌 너비(px). 끌어서 정한 적 없는 열은 `null`. */
  width: number | null
  /** 그 열에서 가장 긴 줄의 길이. */
  text: number
}

/**
 * 표의 칸마다 실제 열 자리를 매긴다. 세로로 합친 칸은 아래 행에 칸이 아예 없어서, 그 행의 칸이
 * 몇 번째 열인지는 위에서부터 세어야만 안다. 워드는 그 빈자리에도 «위와 이어짐» 칸을 요구한다.
 */
export function layoutTable(table: JSONContent): { rows: PlacedCell[][]; columns: TableColumn[] } {
  const tableRows = table.content ?? []
  // 열마다, 위에서 내려온 합친 칸이 앞으로 몇 행을 더 차지하는지.
  const held: { rows: number; colspan: number }[] = []
  const widths: number[] = []
  const texts: number[] = []
  let cols = 0

  const rows = tableRows.map((row, r) => {
    const placed: PlacedCell[] = []
    let col = 0
    const takeHeld = () => {
      while ((held[col]?.rows ?? 0) > 0) {
        held[col].rows -= 1
        placed.push({ node: null, col, colspan: held[col].colspan, rowspan: 1 })
        col += held[col].colspan
      }
    }
    for (const cell of row.content ?? []) {
      takeHeld()
      const colspan = span(cell.attrs?.colspan)
      // 표 끝을 넘는 세로 합치기는 남은 행까지만.
      const rowspan = Math.min(span(cell.attrs?.rowspan), tableRows.length - r)
      placed.push({ node: cell, col, colspan, rowspan })
      held[col] = { rows: rowspan - 1, colspan }
      // 합친 칸은 덮은 열마다 너비를 하나씩 갖는다(`colwidth` 는 배열이다).
      const colwidth: unknown = cell.attrs?.colwidth
      for (let i = 0; i < colspan; i += 1) {
        const width = Array.isArray(colwidth) ? Number(colwidth[i]) : 0
        if (width > 0 && Number.isFinite(width)) widths[col + i] ??= width
      }
      // 여러 열에 걸친 칸의 글은 어느 열의 것인지 알 수 없어 세지 않는다.
      if (colspan === 1) texts[col] = Math.max(texts[col] ?? 0, longestLine(cell))
      col += colspan
    }
    takeHeld()
    cols = Math.max(cols, col)
    return placed
  })

  const columns = Array.from({ length: cols }, (_, col) => ({
    width: widths[col] ?? null,
    text: texts[col] ?? 0,
  }))
  return { rows, columns }
}

/**
 * 열 너비를 `total` 에 맞춘다. 편집기의 표처럼 본문 폭을 꽉 채우고, 너비가 적힌 열은 그 비율을
 * 지킨다. 단위는 받은 그대로다(px 를 주면 px).
 *
 * 너비가 안 적힌 열은 남은 폭을 글 길이의 제곱근 비율로 나눠 갖는다. 편집기에서는 브라우저가 글에
 * 맞춰 나누는데 그 계산을 여기서 따라 할 수는 없다. 똑같이 나누면 긴 글이 좁은 열에서 수십 줄로
 * 접히고, 길이 그대로 나누면 긴 열 하나가 폭을 다 가져간다.
 */
export function columnWidths(columns: TableColumn[], total: number): number[] {
  const open = columns.filter((column) => column.width === null)
  const fixed = sum(columns.map((column) => column.width ?? 0))
  // 적힌 너비만으로 이미 폭을 넘으면 남는 게 없다. 그때도 안 적힌 열이 사라지지 않게 최소 몫을 준다.
  const rest = Math.max(total - fixed, (total * open.length) / (columns.length * 4))
  const weight = (column: TableColumn) => Math.sqrt(Math.max(column.text, 4))
  const weights = sum(open.map(weight))
  const widths = columns.map((column) => column.width ?? (rest * weight(column)) / weights)
  const scale = total / sum(widths)
  return widths.map((width) => width * scale)
}

/**
 * 본문의 블록. 끝에 남은 빈 문단은 뗀다. 편집기는 표나 사진 뒤에 커서를 둘 빈 줄을 늘 하나
 * 두는데, 종이에서는 그 한 줄이 넘쳐 빈 쪽을 만든다.
 */
export function bodyBlocks(doc: JSONContent): JSONContent[] {
  const blocks = [...(doc.content ?? [])]
  while (blocks.length > 0) {
    const last = blocks[blocks.length - 1]
    if (last.type !== 'paragraph' || last.content?.length) break
    blocks.pop()
  }
  return blocks
}

/**
 * 저장할 파일 이름에서 확장자를 뺀 몸통. Windows 가 못 쓰는 글자를 바꾸고, 끝의 점·공백을 뗀다
 * (Windows 가 떼어 버린다).
 */
export function exportFileStem(title: string): string {
  const stem = cleanName(title)
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/[. ]+$/, '')
    .trim()
  return stem || '문서'
}
