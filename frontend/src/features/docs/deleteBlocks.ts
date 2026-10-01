import { Selection, type Transaction } from '@tiptap/pm/state'

/**
 * 선택이 걸친 블록을 통째로 지운다. 지울 수 없는 선택이면 아무것도 하지 않고 false.
 *
 * 선택한 글자만이 아니라 그 글이 든 블록이 대상이다. 목록에서는 선택이 닿은 항목까지만 지운다.
 * `$from.blockRange($to)` 는 문단에서 목록 첫 항목까지 고른 것을 「문단과 목록 전체」로 넓혀서,
 * 고르지 않은 항목까지 지운다. 그래서 양 끝을 따로 잡는다.
 */
export function deleteSelectedBlocks(tr: Transaction): boolean {
  const { doc, selection } = tr

  // 표의 칸 경계를 넘는 선택은 건드리지 않는다. 칸이 빠지면 표가 깨진다.
  // 칸 여러 개를 고른 선택은 범위가 칸마다 하나씩이고, `$from`·`$to` 는 그중 한 칸만 가리킨다.
  if (selection.ranges.length > 1) return false

  // 끝이 블록 맨 앞에 걸쳤으면 그 블록에서는 글자를 하나도 고르지 않은 것이다. Shift+↓ 로 줄 단위로
  // 고르면 늘 이렇게 된다. 앞 블록의 끝으로 당긴다. 시작이 블록 맨 끝에 걸친 것도 같다.
  let { $from, $to } = selection
  if ($from.pos < $to.pos && $to.parent.isTextblock && $to.parentOffset === 0) {
    $to = Selection.findFrom(doc.resolve($to.before()), -1)?.$to ?? $to
  }
  if (
    $from.pos < $to.pos &&
    $from.parent.isTextblock &&
    $from.parentOffset === $from.parent.content.size
  ) {
    $from = Selection.findFrom(doc.resolve($from.after()), 1)?.$from ?? $from
  }

  // 표 밖에서 칸 안까지 이어진 선택.
  const shared = $from.sharedDepth($to.pos)
  for (const $pos of [$from, $to]) {
    for (let depth = shared + 1; depth <= $pos.depth; depth++) {
      if ($pos.node(depth).type.spec.isolating) return false
    }
  }

  // 글이 든 블록에서 시작해, 그 블록이 부모의 첫(끝) 자식인 동안 부모로 올라간다.
  // 항목의 첫 문단부터 지우면 항목이, 목록의 첫 항목부터 지우면 목록이 통째로 대상이다.
  let start = $from.depth
  while (start - 1 > shared && $from.index(start - 1) === 0) start--
  let end = $to.depth
  while (end - 1 > shared && $to.indexAfter(end - 1) === $to.node(end - 1).childCount) end--

  // 글 블록 안이 아니면(사진을 고른 노드 선택) 그 위치가 곧 블록의 경계다.
  // tr.delete 가 아니라 deleteRange 다. 비게 된 부모(항목 하나뿐인 목록)까지 걷어 낸다.
  tr.deleteRange(
    $from.parent.isTextblock ? $from.before(start) : $from.pos,
    $to.parent.isTextblock ? $to.after(end) : $to.pos,
  )
  return true
}
