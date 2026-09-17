import type { TodayTask } from '@/features/home/types'

/**
 * 할 일은 아직 서버 모델이 없다. 화면 구조를 먼저 잡아 두고, 실제로는
 * 문서 체크박스 블록·멘션에서 모이는 형태가 될 자리다.
 *
 * 홈의 멘션 카드가 쓰던 목 데이터는 여기 없다. 알림함(`notificationsDb`)에서 파생시킨다.
 * 같은 사건을 두 벌로 두면 알림함에서 읽음 처리를 해도 홈은 모른다.
 */
export const TODAY_TASKS: TodayTask[] = [
  { id: 't-1', title: '예산안 검토 후 회신', done: false },
  { id: 't-2', title: '근태 설계서 오픈이슈 정리', done: false },
  { id: 't-3', title: '주간 회의록 공유', done: true },
]
