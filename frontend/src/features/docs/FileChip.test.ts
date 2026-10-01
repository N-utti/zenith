import { Editor, generateHTML, generateJSON, type JSONContent } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { expect, it } from 'vitest'
import { FileChip } from './FileChip'
import { ImageBlock } from './ImageBlock'

const extensions = [StarterKit, ImageBlock, FileChip]
const chip = (name: string) => ({ src: '/api/files/f-1', name, size: 1 })

/** 화면 없이 문서 상태만 다룬다. 노드 뷰(React)를 띄우지 않는다. */
function editorWith(content: string) {
  return new Editor({ element: null, extensions, content })
}

/** 블록마다 `종류[안에 든 것]`. 칩은 파일 이름으로, 글자는 그대로 적는다. */
function shape(editor: Editor): string[] {
  const blocks: JSONContent[] = editor.getJSON().content ?? []
  return blocks.map((block) => {
    const inside = (block.content ?? []).map((node) =>
      node.type === 'fileChip' ? `<${node.attrs?.name}>` : (node.text ?? node.type),
    )
    return `${block.type}[${inside.join('')}]`
  })
}

it('칩은 선택한 글과 블록을 지우지 않고 그 끝에 선다', () => {
  const text = editorWith('<p>hello world</p>')
  text.chain().setTextSelection({ from: 1, to: 6 }).setFileChip(chip('a.pdf')).run()
  expect(shape(text)[0]).toBe('paragraph[hello<a.pdf> world]')

  // 손잡이로 블록을 통째로 고른 상태. 그 블록이 칩으로 바뀌면 안 된다.
  const block = editorWith('<p>하나</p><p>둘</p>')
  block.chain().setNodeSelection(0).setFileChip(chip('a.pdf')).run()
  expect(shape(block).slice(0, 3)).toEqual([
    'paragraph[하나]',
    'paragraph[<a.pdf>]',
    'paragraph[둘]',
  ])
})

it('사진 설명과 코드 블록 안에서는 바로 뒤에 새 문단으로 선다', () => {
  // 사진을 넣으면 커서가 설명 칸에 있다. 거기 넣으면 사진을 지울 때 칩도 같이 지워진다.
  const caption = editorWith(
    '<figure data-type="imageBlock"><img src="/api/files/f-9"><figcaption>설명</figcaption></figure>',
  )
  caption.chain().setTextSelection(2).setFileChip(chip('a.pdf')).run()
  expect(shape(caption).slice(0, 2)).toEqual(['imageBlock[설명]', 'paragraph[<a.pdf>]'])

  // 코드 블록은 글자만 받는다. 그대로 넣으면 블록이 둘로 쪼개진다.
  const code = editorWith('<pre><code>line1 line2</code></pre>')
  code.chain().setTextSelection(4).setFileChip(chip('a.pdf')).run()
  expect(shape(code).slice(0, 2)).toEqual(['codeBlock[line1 line2]', 'paragraph[<a.pdf>]'])
})

it('잇달아 넣으면 넣은 순서대로 놓이고, 사진은 고른 블록 바로 뒤에 선다', () => {
  const editor = editorWith('<p>자료</p><p>끝</p>')
  // 「자료」 바로 뒤.
  editor.commands.setTextSelection(3)
  editor.commands.setFileChip(chip('a.pdf'))
  editor.commands.setFileChip(chip('b.pdf'))
  editor.commands.setImageBlock({ src: '/api/files/f-2' })
  editor.commands.setFileChip(chip('c.pdf'))
  expect(shape(editor).slice(0, 4)).toEqual([
    'paragraph[자료<a.pdf><b.pdf>]',
    'imageBlock[]',
    'paragraph[<c.pdf>]',
    'paragraph[끝]',
  ])

  // 블록을 통째로 고른 채 사진을 넣으면 문서 맨 끝이 아니라 그 블록 뒤다.
  const block = editorWith('<p>하나</p><p>둘</p>')
  block.chain().setNodeSelection(0).setImageBlock({ src: '/api/files/f-2' }).run()
  expect(shape(block).slice(0, 3)).toEqual(['paragraph[하나]', 'imageBlock[]', 'paragraph[둘]'])
})

it('숫자처럼 생긴 파일 이름도 글자로 남고, 글자가 아닌 이름이 와도 복사가 죽지 않는다', () => {
  /*
   * TipTap 은 읽는 법을 따로 주지 않은 속성을 숫자·참거짓으로 바꿔 읽는다. 이름이 숫자가 되면
   * ProseMirror 가 그것을 글자가 아니라 태그 명세로 읽어 그 칩이 든 범위를 복사할 때 던진다.
   */
  const json = generateJSON(
    '<p><span data-type="fileChip" src="/api/files/f-1" name="007" size="12"></span></p>',
    extensions,
  )
  const node = json.content[0].content[0]
  expect(node.attrs).toEqual({ src: '/api/files/f-1', name: '007', size: 12 })
  expect(generateHTML(json, extensions)).toContain('>007</span>')

  // 같이 편집하는 사람은 Y.Doc 에 아무 값이나 쓸 수 있다.
  node.attrs.name = 0
  expect(generateHTML(json, extensions)).toContain('>0</span>')
})
