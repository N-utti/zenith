import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { expect, test } from 'vitest'
import { FileChip } from './FileChip'
import { ImageBlock } from './ImageBlock'
import type { UploadedFile } from './types'
import { insertUploaded, isInlineImage } from './useFileUpload'

const uploaded = (name: string, content_type: string): UploadedFile => ({
  id: 'f-1',
  url: '/api/files/f-1',
  name,
  size: 10,
  content_type,
})

/** 올린 파일 하나를 빈 문서에 넣고, 본문에 들어간 노드 종류를 본다. 노드 뷰(React)는 띄우지 않는다. */
function inserted(file: UploadedFile): string {
  const editor = new Editor({ element: null, extensions: [StarterKit, ImageBlock, FileChip] })
  insertUploaded(editor, file, file.name)
  const json = JSON.stringify(editor.getJSON())
  editor.destroy()
  return json
}

// 이름의 확장자로 가르면 이 파일이 사진 블록이 된다. 서버는 내려받기로만 줘서 깨진 그림으로 남는다.
test('이름이 .png 여도 서버가 그림이 아니라고 한 파일은 칩으로 넣는다', () => {
  const json = inserted(uploaded('보고서.png', 'application/octet-stream'))
  expect(json).toContain('"fileChip"')
  expect(json).not.toContain('"imageBlock"')
})

test('확장자가 없어도 서버가 그림이라고 한 파일은 사진 블록으로 넣는다', () => {
  const json = inserted(uploaded('붙여넣은그림', 'image/png'))
  expect(json).toContain('"imageBlock"')
  expect(json).not.toContain('"fileChip"')
})

test('서버가 그림 넷으로 판정한 것만 사진 블록이다', () => {
  for (const type of ['image/png', 'image/jpeg', 'image/gif', 'image/webp']) {
    expect(isInlineImage(type)).toBe(true)
  }
  // SVG 는 같은 오리진에서 스크립트가 돌 수 있어 서버가 그리게 내주지 않는다.
  expect(isInlineImage('image/svg+xml')).toBe(false)
})
