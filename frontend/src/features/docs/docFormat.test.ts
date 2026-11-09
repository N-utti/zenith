import { Editor } from '@tiptap/core'
import { afterEach, expect, it } from 'vitest'
import { docContentExtensions } from './editorExtensions'

// 서식 3차 계약(이슈 #574): 서버 가져오기가 Y.Doc 에 싣는 속성을 편집기가 버리지 않고 그린다.
const editors: Editor[] = []
const make = (content: string | object) => {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: docContentExtensions(),
    content,
  })
  editors.push(editor)
  return editor
}
afterEach(() => editors.splice(0).forEach((e) => e.destroy()))
// jsdom 에는 ClipboardEvent 가 없다. 붙여넣기 경로는 이벤트의 clipboardData 를 보지 않는다.
const paste = () => new Event('paste') as ClipboardEvent

const text = (t: string, attrs: Record<string, unknown>) => ({
  type: 'text',
  text: t,
  marks: [{ type: 'textStyle', attrs }],
})
const cell = (type: string, attrs: Record<string, unknown>) => ({
  type,
  attrs,
  content: [{ type: 'paragraph', content: [{ type: 'text', text: '칸' }] }],
})

// 서버가 싣는 모양 그대로(ydoc.py). 값의 타입도 계약대로: 간격은 정수, 줄 간격은 문자열.
const imported = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      attrs: { lineHeight: '1.6', indent: 40, spaceBefore: 8, spaceAfter: 12, textAlign: 'center' },
      content: [text('글', { fontFamily: "'맑은 고딕'", fontSize: '11pt', color: '#ff0000' })],
    },
    {
      type: 'table',
      attrs: { borders: 'none' },
      content: [
        {
          type: 'tableRow',
          content: [
            cell('tableHeader', { backgroundColor: '#eeeeee' }),
            cell('tableCell', { colwidth: [120] }),
          ],
        },
      ],
    },
  ],
}

it('가져온 서식을 버리지 않는다(문서 JSON 이 그대로 남는다)', () => {
  const json = make(imported).getJSON()
  const p = json.content?.[0]
  expect(p?.attrs).toMatchObject({ lineHeight: '1.6', indent: 40, spaceBefore: 8, spaceAfter: 12 })
  expect(p?.content?.[0].marks?.[0].attrs).toMatchObject({
    fontFamily: "'맑은 고딕'",
    fontSize: '11pt',
    color: '#ff0000',
  })
  const table = json.content?.[1]
  expect(table?.attrs?.borders).toBe('none')
  expect(JSON.stringify(table)).toContain('"backgroundColor":"#eeeeee"')
})

it('가져온 서식을 스타일로 그린다(인쇄·복사가 쓰는 HTML)', () => {
  // 브라우저가 style 을 다시 쓰며 색은 rgb() 로, 글꼴 따옴표는 큰따옴표로 바꾼다. 값은 같다.
  const html = make(imported).getHTML().replaceAll('&quot;', '"')
  expect(html).toContain('line-height: 1.6')
  expect(html).toContain('margin-left: 40px')
  expect(html).toContain('margin-top: 8px')
  expect(html).toContain('margin-bottom: 12px')
  expect(html).toContain('text-align: center')
  expect(html).toContain('font-family: "맑은 고딕"')
  expect(html).toContain('font-size: 11pt')
  expect(html).toContain('data-borders="none"')
  expect(html).toContain('background-color: rgb(238, 238, 238)')
})

it('편집 화면의 표에도 테두리 없음이 붙는다(표 뷰는 renderHTML 을 거치지 않는다)', () => {
  const editor = make(imported)
  expect(editor.view.dom.querySelector('table')?.dataset.borders).toBe('none')
  editor.commands.command(({ tr }) => {
    tr.setNodeAttribute(editor.state.doc.child(0).nodeSize, 'borders', 'all')
    return true
  })
  expect(editor.view.dom.querySelector('table')?.dataset.borders).toBeUndefined()
})

it('HTML 로 받은 서식도 같은 이름으로 읽는다(제니스 안 복사). 다른 단위의 간격은 버린다', () => {
  const json = make(
    '<p style="line-height: 1.5; margin-left: 24px; margin-top: 6pt"><span style="font-family: Arial; font-size: 12px">글</span></p>',
  ).getJSON()
  const p = json.content?.[0]
  expect(p?.attrs).toMatchObject({ lineHeight: '1.5', indent: 24, spaceBefore: null })
  expect(p?.content?.[0].marks?.[0].attrs).toMatchObject({ fontFamily: 'Arial', fontSize: '12px' })
})

it('바깥에서 붙여넣은 간격·글꼴·크기·줄 간격·칸 배경은 벗긴다. 제니스에서 복사한 것은 남긴다', () => {
  const outside =
    '<p style="margin-top: 0px; margin-bottom: 16px; line-height: 1.38"><span style="font-family: Arial; font-size: 14px; color: #e0483d">글</span></p>' +
    // 구글 문서는 전체를 굵기 normal 인 <b> 로 감싸고, 굵은 글은 span 의 굵기로 싣는다.
    '<b style="font-weight: normal"><p><span style="font-weight: 700; font-size: 11pt">굵게</span> 보통</p></b>' +
    '<table data-borders="none"><tr><td style="background-color: #ffffff">칸</td></tr></table>'
  const editor = make('<p></p>')
  editor.view.pasteHTML(outside, paste())
  const html = editor.getHTML()
  for (const gone of [
    'margin',
    'line-height',
    'font-family',
    'font-size',
    'background-color',
    'data-borders',
  ])
    expect(html).not.toContain(gone)
  // 글자색과 굵게는 예전처럼 받는다. 굵기 normal 겉싸개는 굵게가 되지 않는다.
  expect(html).toContain('color')
  expect(html).toContain('<strong>굵게</strong> 보통')

  const inside = make('<p></p>')
  inside.view.pasteHTML(
    '<p data-pm-slice="0 0 []" style="margin-top: 8px"><span style="font-family: Arial">글</span></p>',
    paste(),
  )
  expect(inside.getHTML()).toContain('margin-top: 8px')
  expect(inside.getHTML()).toContain('font-family: Arial')
})

it('기존 표는 테두리 값을 새로 갖지 않는다. 투명 칸 배경은 없는 것으로 본다', () => {
  const editor = make('<table><tr><th style="background-color: transparent">칸</th></tr></table>')
  const table = editor.getJSON().content?.[0]
  expect(table?.attrs?.borders).toBeNull()
  expect(editor.getHTML()).not.toContain('transparent')
})

it('서식 값에 스타일을 끼워 넣을 수 없다(남의 편집·붙여넣기 모두)', () => {
  const evil = 'red;background-image:url(https://evil.example/a)'
  const synced = make({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        attrs: {
          lineHeight: evil,
          indent: evil,
          spaceBefore: '8;x',
          spaceAfter: -4,
          textAlign: evil,
        },
        content: [text('글', { fontFamily: evil, fontSize: evil, color: evil })],
      },
      {
        type: 'table',
        content: [
          {
            type: 'tableRow',
            attrs: { height: '1px;background-image:url(https://evil.example/r);x:' },
            content: [cell('tableCell', { backgroundColor: evil, align: evil })],
          },
        ],
      },
    ],
  })
  expect(synced.getHTML()).not.toContain('evil.example')
  expect(synced.view.dom.innerHTML).not.toContain('evil.example')

  const pasted = make(
    `<p><span style="font-family: x;background-image:url(https://evil.example/b)">글</span></p>`,
  )
  expect(pasted.getHTML()).not.toContain('evil.example')

  // 짝이 안 맞는 따옴표는 뒤 선언을 삼킨다. 글꼴만 버리고 크기는 남는다.
  const quote = make({
    type: 'doc',
    content: [{ type: 'paragraph', content: [text('글', { fontFamily: '"a', fontSize: '11pt' })] }],
  })
  expect(quote.getHTML()).not.toContain('font-family')
  expect(quote.getHTML()).toContain('font-size: 11pt')

  // 크기 0 은 글을 숨긴다.
  const hidden = make({
    type: 'doc',
    content: [{ type: 'paragraph', content: [text('글', { fontSize: '0pt' })] }],
  })
  expect(hidden.getHTML()).not.toContain('font-size')
})
