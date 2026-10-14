/**
 * 근거 동작(백엔드 #385 `cite`·`conform`)의 초안을 문장 묶음으로 푼다.
 *
 * 두 동작 모두 서버가 문서 전체를 서식 없는 평문으로 다시 써서 준다. 그대로 넣으면 표·제목 서식이 사라지므로
 * 화면은 문장 단위로만 다룬다: 근거 달기는 각주가 붙은 문장을, 규정에 맞게 고치기는 원문과 달라진 문장을 고른다.
 * 정규식은 우리가 정한 각주 표식(`[[n]]`)과 문장 경계에만 쓴다. AI 가 낸 글 자체를 정규식으로 읽지 않는다.
 */

import type { Editor } from '@tiptap/core'
import { findText } from './findText'

const CITE = /\[\[(\d+)\]\]/g

export interface DraftItem {
  /** 본문에 지금 있는 문장. 근거 달기에서는 `after` 와 같다. */
  before: string
  /** 각주 표식을 뺀 결과 문장. */
  after: string
  /** 이 문장에 달린 근거 번호(`citations[].n`). */
  refs: number[]
}

type Sentence = { text: string; line: number }

/**
 * 줄로 나눈 뒤 문장 끝(마침표·물음표·느낌표) 뒤 공백에서 자른다. 각주 앞 공백은 문장에 붙여 둔다.
 * 줄 번호를 같이 든다. 줄은 편집기의 블록(문단·표 칸)이라, 다른 줄의 문장을 한 묶음으로 바꿀 수는 없다.
 */
function sentences(text: string): Sentence[] {
  return text
    .replace(/[^\S\n]+(?=\[\[\d+\]\])/g, '')
    .split('\n')
    .flatMap((line, index) =>
      line.split(/(?<=[.?!。](?:\[\[\d+\]\])*)\s+/).map((s) => ({
        text: s.split(/\s+/).filter(Boolean).join(' '),
        line: index,
      })),
    )
    .filter((s) => s.text)
}

const strip = (s: string) => s.replace(CITE, '').trim()
const refsOf = (s: string) => [...new Set([...s.matchAll(CITE)].map((m) => Number(m[1])))]

/** 근거 달기: 각주가 붙은 문장만. 본문은 그대로라 원문과 결과가 같다. */
export function citedSentences(draft: string): DraftItem[] {
  return sentences(draft)
    .map((s) => s.text)
    .filter((s) => refsOf(s).length > 0)
    .map((s) => ({ before: strip(s), after: strip(s), refs: refsOf(s) }))
}

/** 같은 줄끼리 모은다. */
function byLine(list: Sentence[]): Sentence[][] {
  const groups: Sentence[][] = []
  for (const s of list) {
    const last = groups.at(-1)
    if (last && last[0].line === s.line) last.push(s)
    else groups.push([s])
  }
  return groups
}

/**
 * 규정에 맞게 고치기: 원문과 달라진 문장 묶음. 문장 단위 최장 공통 부분열로 맞춘다.
 * 같은 자리에서 바뀐 문장이 이어지면 한 묶음이다. 그 묶음이 여러 줄에 걸치고 양쪽 줄 수가 같으면 줄마다 나눈다
 * (이웃한 두 문단이나 한 행의 두 칸이 함께 고쳐진 경우). 원문 쪽이나 결과 쪽이 빈 묶음(문장 추가·삭제)도 돌려준다.
 */
// ponytail: 문장 수 곱만큼 표를 만든다. 서버 입력 상한이 8,000자라 수백 문장 안쪽이다.
export function changedSentences(original: string, draft: string): DraftItem[] {
  const a = sentences(original)
  const b = sentences(draft)
  const key = b.map((s) => strip(s.text))
  const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      lcs[i][j] =
        a[i].text === key[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])

  const items: DraftItem[] = []
  const item = (removed: Sentence[], added: Sentence[]): DraftItem => ({
    before: removed.map((s) => s.text).join(' '),
    after: added.map((s) => strip(s.text)).join(' '),
    refs: [...new Set(added.flatMap((s) => refsOf(s.text)))],
  })
  let removed: Sentence[] = []
  let added: Sentence[] = []
  const flush = () => {
    const from = byLine(removed)
    const to = byLine(added)
    if (from.length > 1 && from.length === to.length) {
      from.forEach((group, k) => items.push(item(group, to[k])))
    } else if (removed.length || added.length) {
      items.push(item(removed, added))
    }
    removed = []
    added = []
  }
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i].text === key[j]) {
      flush()
      i++
      j++
    } else if (j < b.length && (i === a.length || lcs[i][j + 1] >= lcs[i + 1][j])) {
      added.push(b[j++])
    } else {
      removed.push(a[i++])
    }
  }
  flush()
  return items
}

const isHigh = (code: number) => code >= 0xd800 && code <= 0xdbff
const isLow = (code: number) => code >= 0xdc00 && code <= 0xdfff

/**
 * 고친 문장을 본문의 그 자리에만 넣는다. 평문 검색으로 찾고(`findText`), 원문과 결과의 같은 앞뒤는 두고
 * 달라진 가운데 글자만 바꾼다. 그래야 문장 안 굵은 글씨·링크도 바뀌지 않은 부분에서는 남는다.
 *
 * 바꾸지 않는 경우:
 * - `missing`: 본문에서 못 찾음(두 문단에 걸쳤거나 그 사이 고쳐짐).
 * - `manual`: 같은 글이 여러 군데 있어 어느 것인지 모르거나, 그 문장 안에 파일 칩 같은 글자 아닌 것이 있어
 *   글자 자리를 셀 수 없음. 엉뚱한 자리를 바꾸느니 사람에게 넘긴다.
 */
export function replaceSentence(editor: Editor, item: DraftItem): 'done' | 'missing' | 'manual' {
  const { doc } = editor.state
  const { before, after } = item
  const range = findText(doc, before)
  if (!range || !after) return 'missing'
  if (findText(doc, before, range.from + 1)) return 'manual'
  // 글자만 있는 구간이어야 위치와 글자 순번이 하나씩 맞는다.
  if (doc.textBetween(range.from, range.to) !== before) return 'manual'

  let head = 0
  while (head < before.length && head < after.length && before[head] === after[head]) head++
  let tail = 0
  while (
    tail < before.length - head &&
    tail < after.length - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  )
    tail++
  // 두 칸짜리 글자(이모지 등)의 절반에서 끊지 않는다.
  if (head > 0 && isHigh(before.charCodeAt(head - 1))) head--
  if (tail > 0 && isLow(before.charCodeAt(before.length - tail))) tail--

  const from = range.from + head
  const to = range.to - tail
  const text = after.slice(head, after.length - tail)
  editor
    .chain()
    .command(({ tr }) => {
      if (text) tr.insertText(text, from, to)
      else tr.delete(from, to)
      return true
    })
    .run()
  return 'done'
}
