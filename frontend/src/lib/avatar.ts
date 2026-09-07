/**
 * 아바타 색조. 서버는 색을 주지 않으므로(04 §1 `/me`) id 를 해시해 한 사람이 늘 같은 색을 갖게 한다.
 * 같은 id 는 어느 화면·어느 기기에서도 같은 색이다.
 */
export function hueOf(id: string): number {
  let hash = 0
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return hash % 360
}
