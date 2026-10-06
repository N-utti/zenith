import { Editor } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import { docContentExtensions } from './editorExtensions'
import { parseMarkdownTable, tableToHtml, textToHtml } from './markdownTable'

const MD = '| 항목 | 내용 | 담당 |\n| --- | --- | --- |\n| 정리 대상 | 위 본문 | 미정 |'

describe('parseMarkdownTable', () => {
  it('머리글·구분선·본문을 행 배열로 푼다', () => {
    expect(parseMarkdownTable('| 항목 | 내용 |\n| :---: | --- |\n| a | b |')).toEqual([
      ['항목', '내용'],
      ['a', 'b'],
    ])
  })

  it('앞뒤 안내 문장이 붙어 있어도 표 구간만 뽑는다', () => {
    expect(
      parseMarkdownTable(`다음과 같이 정리했습니다.\n${MD}\n\n필요하면 고치세요.`),
    ).toHaveLength(2)
  })

  it('표가 아니거나 열 수가 어긋나면 null', () => {
    expect(parseMarkdownTable('그냥 문장')).toBeNull()
    expect(parseMarkdownTable('| 머리글만 |')).toBeNull()
    expect(parseMarkdownTable('| a |\n| b |')).toBeNull()
    expect(parseMarkdownTable('| a | b |\n| --- | --- |\n| 1 | 2 | 3 |')).toBeNull()
    expect(parseMarkdownTable('| a\\|b | c |\n| --- | --- |\n| 1 | 2 |')).toBeNull()
  })
})

describe('tableToHtml', () => {
  it('첫 행은 th, 나머지는 td, 셀은 이스케이프', () => {
    expect(
      tableToHtml([
        ['h', '<x>'],
        ['a', '&'],
      ]),
    ).toBe(
      '<table><tbody><tr><th>h</th><th>&lt;x&gt;</th></tr><tr><td>a</td><td>&amp;</td></tr></tbody></table>',
    )
  })
})

describe('편집기 삽입', () => {
  const html = tableToHtml(parseMarkdownTable(MD)!)
  const make = (content: string) => new Editor({ extensions: docContentExtensions(), content })

  it('실제 표 노드로 들어간다', () => {
    const editor = make('<p>앞</p>')
    editor.commands.insertContentAt(editor.state.doc.content.size, html)
    expect(editor.getHTML()).toContain('<th colspan="1" rowspan="1"><p>항목</p></th>')
    expect(editor.getJSON().content?.filter((n) => n.type === 'table')).toHaveLength(1)
    editor.destroy()
  })

  it('아래에 추가: 문단 중간에서 눌러도 문단은 그대로 두고 그 다음에 표가 온다', () => {
    const editor = make('<p>앞뒤</p><p>다음</p>')
    const $at = editor.state.doc.resolve(2)
    editor.commands.insertContentAt($at.after(1), html)
    expect(editor.getJSON().content?.map((n) => n.type)).toEqual([
      'paragraph',
      'table',
      'paragraph',
    ])
    expect(editor.getHTML()).toContain('<p>앞뒤</p>')
    editor.destroy()
  })

  it('셀 안에서 넣어도 표가 셀 안에 중첩되지 않는다', () => {
    const editor = make(html)
    // 첫 머리글 셀 안의 문단 텍스트 위치.
    editor.commands.insertContentAt(4, html)
    const json = JSON.stringify(editor.getJSON())
    expect(json).not.toMatch(/"tableHeader".{0,80}"type":"table"/)
    editor.destroy()
  })
})

describe('textToHtml', () => {
  it('AI 초안의 태그를 글자로 넣는다. 그림·링크·스크립트가 편집기 노드가 되지 않는다', () => {
    const html = textToHtml(
      '요약입니다.\n<img src="https://evil.example/x.png?d=secret">\n\n<a href="javascript:alert(1)">링크</a> & <b>굵게</b>',
    )
    expect(html).not.toMatch(/<img|<a |<b>|<script/)
    expect(html).toBe(
      '<p>요약입니다.<br>&lt;img src="https://evil.example/x.png?d=secret"&gt;</p>' +
        '<p>&lt;a href="javascript:alert(1)"&gt;링크&lt;/a&gt; &amp; &lt;b&gt;굵게&lt;/b&gt;</p>',
    )
  })

  it('편집기에 넣어도 그림 블록이 생기지 않는다', () => {
    const editor = new Editor({ extensions: docContentExtensions(), content: '<p>앞</p>' })
    editor.commands.insertContentAt(
      editor.state.doc.content.size,
      textToHtml('<img src="https://evil.example/x.png">'),
    )
    const types = JSON.stringify(editor.getJSON())
    expect(types).not.toContain('imageBlock')
    expect(editor.getText()).toContain('<img src="https://evil.example/x.png">')
    editor.destroy()
  })

  it('빈 줄로 문단을 나누고 빈 글은 빈 문자열이다', () => {
    expect(textToHtml('가\r\n\r\n\n나')).toBe('<p>가</p><p>나</p>')
    expect(textToHtml('  \n\n ')).toBe('')
  })
})
