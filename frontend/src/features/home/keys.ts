/**
 * 홈 카드의 캐시 키. 홈 밖에서도 무효화하는 것들이라 상수로 둔다.
 * 각자 문자열을 적으면 한쪽에서 이름을 바꿔도 타입 오류 없이 조용히 끊긴다.
 */
export const homeKeys = {
  announcements: ['announcements'] as const,
  mentions: ['mentions'] as const,
  events: ['events'] as const,
  todos: ['me', 'todos'] as const,
}
