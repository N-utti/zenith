/**
 * 손가락이 움직인 거리로 넘길 방향을 정한다. 왼쪽으로 밀면 다음(1), 오른쪽은 이전(-1), 아니면 0.
 * 세로 스크롤을 빼앗지 않게 가로가 세로보다 확실히 길 때만 넘긴다. 50px 은 날짜 칸을 누르다
 * 손이 조금 밀린 것과 일부러 민 것을 가르는 선이다.
 */
export function swipeStep(dx: number, dy: number): -1 | 0 | 1 {
  if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return 0
  return dx < 0 ? 1 : -1
}
