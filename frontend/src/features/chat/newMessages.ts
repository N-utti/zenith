/**
 * 위를 읽으러 올라간 뒤에 온 메시지 수. `anchorId` 는 바닥에서 마지막으로 본 메시지다.
 *
 * 그 메시지가 지워져 목록에 없으면 0 이다. 어디부터 새것인지 알 수 없는데 숫자를 지어내지 않는다.
 */
export function countAfter(items: readonly { id: string }[], anchorId: string | null) {
  if (!anchorId) return 0
  const at = items.findIndex((item) => item.id === anchorId)
  return at < 0 ? 0 : items.length - 1 - at
}
