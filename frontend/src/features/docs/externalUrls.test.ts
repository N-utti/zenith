import { Editor } from '@tiptap/core'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, expect, it } from 'vitest'
import { docContentExtensions } from './editorExtensions'
import { ImageBlockView } from './ImageBlockView'

// 붙여넣기와 남의 편집(Y.Doc)으로 바깥 주소가 들어와도 편집기가 그것을 부르는 노드·스타일을 만들지 않는다.
const editors: Editor[] = []
const make = (content: string | object) => {
  const editor = new Editor({ extensions: docContentExtensions(), content })
  editors.push(editor)
  return editor
}
afterEach(() => editors.splice(0).forEach((e) => e.destroy()))

it('바깥 주소의 그림은 사진 블록이 되지 않는다. 올린 파일은 그대로 된다', () => {
  const outside = make('<p>앞</p><img src="https://evil.example/x.png?d=1">')
  expect(JSON.stringify(outside.getJSON())).not.toContain('imageBlock')
  expect(outside.getHTML()).not.toContain('evil.example')

  const mine = make('<img src="/api/files/abc-123">')
  expect(mine.getJSON().content?.[0]).toMatchObject({
    type: 'imageBlock',
    attrs: { src: '/api/files/abc-123' },
  })
})

it('같은 서버의 절대 주소는 경로만 남겨 받는다. data: 그림은 받지 않는다', () => {
  const same = make(`<img src="${window.location.origin}/api/files/abc-123">`)
  expect(same.getJSON().content?.[0]).toMatchObject({ attrs: { src: '/api/files/abc-123' } })
  const inline = make('<p>앞<img src="data:image/png;base64,iVBORw0KGgo=">뒤</p>')
  expect(JSON.stringify(inline.getJSON())).not.toContain('imageBlock')
})

it('사진 블록 화면은 바깥 주소를 <img> 로 그리지 않는다(데스크톱 앱이 실제로 부르는 자리)', () => {
  const view = (src: string) =>
    renderToStaticMarkup(
      createElement(ImageBlockView, {
        node: { attrs: { src, alt: null, width: null } },
        editor: { isEditable: true },
        selected: false,
        updateAttributes: () => {},
      } as never),
    )
  expect(view('https://evil.example/z.png')).not.toContain('<img')
  expect(view('https://evil.example/z.png')).not.toContain('separator')
  expect(view('/api/files/abc-123')).toContain('<img')
})

it('사진 블록 모양으로 와도 바깥 주소는 블록이 되지 않는다. 남의 편집으로 들어온 주소도 그리지 않는다', () => {
  // figure 로 와도 바깥 주소면 사진 블록을 만들지 않고 캡션 글만 남긴다.
  const figure = make(
    '<figure data-type="imageBlock"><img src="https://evil.example/y.png"><figcaption>설명</figcaption></figure>',
  )
  expect(JSON.stringify(figure.getJSON())).not.toContain('imageBlock')
  expect(figure.getText()).toContain('설명')
  expect(figure.getHTML()).not.toContain('evil.example')

  // Y.Doc 은 속성을 거르지 않고 그대로 싣는다. 그릴 때 거른다.
  const synced = make({
    type: 'doc',
    content: [{ type: 'imageBlock', attrs: { src: 'https://evil.example/z.png' } }],
  })
  expect(synced.getHTML()).not.toContain('evil.example')
})

it('형광펜 색에 스타일을 끼워 넣을 수 없다. 툴바 색은 그대로 남는다', () => {
  const injected = make(
    '<p><mark data-color="red;background-image:url(https://evil.example/p)">글</mark></p>',
  )
  expect(injected.getHTML()).not.toContain('evil.example')

  const synced = make({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: '글',
            marks: [
              {
                type: 'highlight',
                attrs: { color: 'red;background-image:url(https://evil.example/q)' },
              },
            ],
          },
        ],
      },
    ],
  })
  expect(synced.getHTML()).not.toContain('evil.example')

  // 다른 앱에서 붙여넣은 style 형광펜은 원래 표기 그대로 산다.
  const pasted = make('<p><mark style="background-color: #fef08a">글</mark></p>')
  expect(pasted.getHTML()).toContain('data-color="#fef08a"')

  const toolbar = make('<p><mark data-color="#fef08a">글</mark></p>')
  expect(toolbar.getHTML()).toContain('data-color="#fef08a"')
})
