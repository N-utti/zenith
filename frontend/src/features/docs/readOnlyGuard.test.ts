import { Editor } from '@tiptap/core'
import Collaboration from '@tiptap/extension-collaboration'
import { prosemirrorJSONToYDoc } from '@tiptap/y-tiptap'
import { expect, it } from 'vitest'
import * as Y from 'yjs'
import { docContentExtensions, ReadOnlyGuard } from './editorExtensions'

const schema = new Editor({ extensions: docContentExtensions() }).schema

/** 끝이 제목인 문서. 편집기의 끝 빈 문단 확장이 문단을 덧붙이려 한다. */
function lockedDoc() {
  return prosemirrorJSONToYDoc(
    schema,
    {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '제1장' }] },
      ],
    },
    'default',
  )
}

/** 읽기 전용으로 열고, 그동안 이 편집기가 Y.Doc 에 쓴 횟수를 센다. */
async function writesOnOpen(guard: boolean) {
  const doc = lockedDoc()
  let writes = 0
  doc.on('update', () => writes++)
  const editor = new Editor({
    editable: false,
    extensions: [
      ...docContentExtensions(),
      Collaboration.configure({ document: doc }),
      ...(guard ? [ReadOnlyGuard] : []),
    ],
  })
  // 첫 그리기와 그 뒤의 비교는 한 박자 늦게 돈다.
  await new Promise((resolve) => setTimeout(resolve, 20))
  editor.commands.setTextSelection(1)
  await new Promise((resolve) => setTimeout(resolve, 20))
  editor.destroy()
  return writes
}

it('잠긴 문서를 열기만 해도 편집기가 Y.Doc 에 쓰는 것을 막는다(서버가 4423 으로 끊는다)', async () => {
  // 막지 않으면 실제로 쓴다. 이 테스트가 헛돌지 않는다는 확인이다.
  expect(await writesOnOpen(false)).toBeGreaterThan(0)
  expect(await writesOnOpen(true)).toBe(0)
})

it('다른 사람에게서 온 변경은 읽기 전용이어도 받는다', async () => {
  const doc = lockedDoc()
  const editor = new Editor({
    editable: false,
    extensions: [
      ...docContentExtensions(),
      Collaboration.configure({ document: doc }),
      ReadOnlyGuard,
    ],
  })
  await new Promise((resolve) => setTimeout(resolve, 20))
  const remote = new Y.Doc()
  Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc))
  const para = new Y.XmlElement('paragraph')
  para.insert(0, [new Y.XmlText('제2장')])
  remote.getXmlFragment('default').push([para])
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote, Y.encodeStateVector(doc)))
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(editor.getText()).toContain('제2장')
  editor.destroy()
})
