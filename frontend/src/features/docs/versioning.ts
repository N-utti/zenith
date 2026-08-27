import * as Y from 'yjs'
import { yXmlFragmentToProsemirrorJSON } from '@tiptap/y-tiptap'
import type { JSONContent } from '@tiptap/react'

/**
 * Yjs 스냅샷은 "이 시점의 상태"를 가리키는 표식이지 내용 사본이 아니다.
 * 복원할 때 실제 내용은 Y.Doc이 들고 있는 이력에서 되살린다. 그래서
 * 스냅샷 자체는 작고, 대신 Y.Doc이 gc: false 여야 한다.
 */

function toBase64(bytes: Uint8Array): string {
  // 큰 배열을 한 번에 spread 하면 인자 개수 한계에 걸린다.
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** 지금 상태의 스냅샷. 서버에 그대로 보관한다. */
export function takeSnapshot(doc: Y.Doc): string {
  return toBase64(Y.encodeSnapshot(Y.snapshot(doc)))
}

export interface RestoredContent {
  json: JSONContent
  title: string | undefined
}

/**
 * 스냅샷 시점의 문서를 읽어 온다. 미리보기와 되돌리기가 같은 경로를 쓴다.
 *
 * ProseMirror JSON으로 꺼내는 이유는 되돌리기 때문이다. 되돌리기를 Y.Doc
 * 교체로 구현하면 접속 중인 다른 사람의 상태와 병합되면서 도로 취소된다.
 * JSON으로 꺼내 에디터에 넣으면 평범한 편집 한 번으로 처리돼, 모두가 같은
 * 결과로 수렴하고 되돌리기 자체도 Ctrl+Z로 취소할 수 있다.
 */
export function readSnapshot(doc: Y.Doc, encoded: string): RestoredContent {
  const restored = Y.createDocFromSnapshot(doc, Y.decodeSnapshot(fromBase64(encoded)))
  return {
    json: yXmlFragmentToProsemirrorJSON(restored.getXmlFragment('default')) as JSONContent,
    title: restored.getMap<string>('meta').get('title'),
  }
}
