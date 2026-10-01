import type { ResolvedPos } from '@tiptap/pm/model'
import { Selection, type Transaction } from '@tiptap/pm/state'

/**
 * 선택이 걸친 블록을 통째로 지운다. 지울 것이 없거나 지울 수 없는 선택이면 아무것도 하지 않고 false.
 *
 * 선택한 글자만이 아니라 그 글이 든 블록이 대상이다. 목록에서는 선택이 닿은 항목까지만 지운다.
 * `$from.blockRange($to)` 는 문단에서 목록 첫 항목까지 고른 것을 「문단과 목록 전체」로 넓혀서,
 * 고르지 않은 항목까지 지운다. 그래서 양 끝을 따로 잡는다.
 */
export function deleteSelectedBlocks(tr: Transaction): boolean {
  const { doc, selection } = tr
  const { $from, $to, empty } = selection

  // 칸 여러 개를 고른 선택은 범위가 칸마다 하나씩이고, `$from`·`$to` 는 그중 한 칸만 가리킨다.
  if (selection.ranges.length > 1) return false

  // 양 끝을 블록과 블록 사이의 자리로 옮긴다. 보통은 글이 든 블록의 앞과 뒤다.
  // 끝이 블록 맨 앞에 걸쳤으면 그 블록에서는 글자를 하나도 고르지 않은 것이라 그 블록 앞에서 끊는다.
  // Shift+↓ 로 줄 단위로 고르면 늘 이렇게 된다. 시작이 블록 맨 끝에 걸친 것도 같다.
  // 글 블록 안이 아니면(구분선을 고른 노드 선택) 그 자리가 이미 블록 사이다.
  let $start = $from
  if ($from.parent.isTextblock) {
    const untouched = !empty && $from.parentOffset === $from.parent.content.size
    $start = doc.resolve(untouched ? $from.after() : $from.before())
  }
  let $end = $to
  if ($to.parent.isTextblock) {
    const untouched = !empty && $to.parentOffset === 0
    $end = doc.resolve(untouched ? $to.before() : $to.after())
  }

  // 상자의 맨 앞(맨 끝)에 놓인 자리는 그 상자의 앞(뒤)과 같은 자리다. 두 끝이 함께 든 상자까지 밖으로 뺀다.
  // 그래야 항목의 첫 문단부터 지울 때 항목이, 목록의 첫 항목부터 지울 때 목록이 껍데기째 지워진다.
  // 표의 칸은 넘지 않는다. 넘으면 칸의 글을 전부 고른 것이 「칸을 지워라」가 되어 줄이 합쳐진다.
  const shared = $start.sharedDepth($end.pos)
  const outward = ($pos: ResolvedPos) => {
    while ($pos.depth > shared && !$pos.parent.type.spec.isolating) {
      if ($pos.parentOffset === 0) $pos = doc.resolve($pos.before())
      else if ($pos.parentOffset === $pos.parent.content.size) $pos = doc.resolve($pos.after())
      else break
    }
    return $pos
  }
  $start = outward($start)
  $end = outward($end)

  // 블록의 경계만 고른 선택(앞 블록 맨 끝에서 다음 블록 맨 앞까지).
  if ($start.pos >= $end.pos) return false

  // 한쪽 끝이 칸 안에 남았는데 다른 끝은 그 칸 밖이면(다른 칸, 표 밖) 건드리지 않는다.
  // 칸이 빠지면 표가 깨진다. 표를 통째로 건너 고른 선택은 양 끝이 표 밖이라 여기에 걸리지 않는다.
  for (const $pos of [$start, $end]) {
    for (let depth = shared + 1; depth <= $pos.depth; depth++) {
      if ($pos.node(depth).type.spec.isolating) return false
    }
  }

  // tr.delete 가 아니라 deleteRange 다. 비게 된 부모(항목 하나뿐인 목록)까지 걷어 낸다.
  // 아래에 딸린 목록이 있는 항목은 글만 비고 딸린 항목은 남는다. 고르지 않은 것은 지우지 않는다.
  const before = tr.steps.length
  tr.deleteRange($start.pos, $end.pos)

  // 지운 자리의 글자 위치로 커서를 접는다. 그대로 두면 선택이 옆의 구분선으로 옮겨 가거나
  // 전체 선택이 남아서, 서식 줄이 계속 떠 있고 한 번 더 누르면 그것까지 지워진다.
  const $cut = tr.doc.resolve(tr.mapping.slice(before).map($start.pos))
  const cursor = Selection.findFrom($cut, 1, true) ?? Selection.findFrom($cut, -1, true)
  if (cursor) tr.setSelection(cursor)
  return true
}
