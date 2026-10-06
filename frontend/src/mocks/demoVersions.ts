import * as Y from 'yjs'
import { toBase64 } from '@/features/docs/versioning'

/**
 * 버전 기록을 바로 볼 수 있게 개발용 버전 몇 개를 지어낸다.
 *
 * 스냅샷은 내용 사본이 아니라 문서 이력 위의 표식이라(`versioning.ts`) 미리 적어 둘 수 없다.
 * 본문은 개발 릴레이가 들고 있고 이력은 띄울 때마다 다르다. 그래서 지금 열린 문서의 스냅샷에
 * "이때는 이 블록이 없었다"는 삭제 표시만 얹어 과거처럼 보이는 스냅샷을 만든다.
 * 문서(Y.Doc)는 건드리지 않는다.
 */

type Range = { client: number; clock: number; len: number }

/** 화면에 떠 있는 편집기에서 Y.Doc 을 꺼낸다. 목은 문서에 닿을 길이 달리 없다. */
function openDoc(): Y.Doc | undefined {
  const el = document.querySelector('.zenith-editor') as
    | (Element & {
        editor?: {
          extensionManager: { extensions: { name: string; options: { document?: Y.Doc } }[] }
        }
      })
    | null
  return el?.editor?.extensionManager.extensions.find((ext) => ext.name === 'collaboration')
    ?.options.document
}

/** 블록 하나를 통째로. 블록 항목을 지우면 그 안의 글도 같이 빠진다. */
function blockRange(block: Y.AbstractType<unknown>): Range | null {
  const id = block._item?.id
  return id ? { ...id, len: 1 } : null
}

/** 블록 첫 글줄의 뒤쪽 절반. 그 블록이 고쳐 쓴 문단으로 보인다. */
function textRange(block: Y.AbstractType<unknown>): Range | null {
  const text = block instanceof Y.XmlElement ? block.get(0) : null
  if (!(text instanceof Y.XmlText)) return null
  for (let item = text._start; item; item = item.right) {
    if (!item.deleted && item.content instanceof Y.ContentString && item.length >= 4) {
      const half = Math.floor(item.length / 2)
      return { client: item.id.client, clock: item.id.clock + item.length - half, len: half }
    }
  }
  return null
}

/** 오래된 것부터. 블록이 셋보다 적거나 편집기가 아직 없으면 빈 배열(다음에 다시 시도한다). */
export function demoSnapshots(): string[] {
  const doc = openDoc()
  if (!doc) return []
  const blocks = doc.getXmlFragment('default').toArray() as Y.AbstractType<unknown>[]
  if (blocks.length < 3) return []

  const now = Y.snapshot(doc)
  const without = (...ranges: (Range | null)[]) => {
    const extra = Y.createDeleteSet()
    for (const range of ranges) {
      if (!range) continue
      const list = extra.clients.get(range.client) ?? []
      list.push({ clock: range.clock, len: range.len })
      extra.clients.set(range.client, list)
    }
    return toBase64(Y.encodeSnapshot(Y.createSnapshot(Y.mergeDeleteSets([now.ds, extra]), now.sv)))
  }

  // 문서 끝의 빈 줄은 더해도 눈에 안 띈다. 글이 있는 마지막 블록을 고른다.
  const hasText = (block: Y.AbstractType<unknown>) =>
    String(block.toJSON())
      .replace(/<[^>]+>/g, '')
      .trim() !== ''
  const last = blockRange(blocks.findLast(hasText) ?? blocks[blocks.length - 1])
  const middle = blockRange(blocks[Math.floor(blocks.length / 2)])
  const edited =
    blocks
      .slice(0, Math.floor(blocks.length / 2))
      .map(textRange)
      .find(Boolean) ?? null

  return [
    // 마지막 블록이 아직 없다.
    without(last, edited),
    // 마지막 블록을 더하고 가운데 블록을 지웠다.
    without(middle, edited),
    // 가운데 블록을 되살렸다.
    without(edited),
    // 앞쪽 문단 하나를 고쳐 썼다. 지금 문서와 같다.
    without(),
  ]
}
