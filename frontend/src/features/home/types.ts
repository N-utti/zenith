import type { Role, Schema } from '@/types'
import type { Notification } from '@/features/notifications/types'

/**
 * 이어서 작업 카드의 문서. 백엔드 `RecentDoc`. 문서 목록의 `DocSummary` 와 다르다.
 * `path` 는 최상위부터의 폴더 이름이고 카드에 경로로 그린다.
 */
export type RecentDoc = Schema<'RecentDoc'>

/**
 * 안 읽은 대화. 백엔드 `UnreadChannel`. 0인 채널은 서버가 빼고 준다.
 *
 * `name` 은 DM 이면 상대 이름. `peer_id` 는 DM 이면 상대, 채널이면 `null`(키는 항상 있다).
 * 아바타 색을 이름이 아니라 사람으로 정한다.
 */
export type UnreadChannel = Schema<'UnreadChannel'>

/**
 * 홈 공지 카드의 글. 백엔드 `HomePost`.
 *
 * 게시판 목록의 `BoardPost` 와 다르다. 게시판 이름·등급이 실려 오고(따로 조회할 필요가 없다)
 * 고정 여부(`pinned`)는 없다. 권한 밖이면 서버가 제목을 가리고 `masked` 를 세운다.
 * 서버는 `min_role` 을 문자열로만 알려 줘서 등급 셋으로 좁혀 둔다.
 */
export type HomePost = Omit<Schema<'HomePost'>, 'min_role'> & { min_role: Role }

/**
 * 홈 한 벌. 백엔드 `HomeOut`.
 *
 * 카드 다섯 개가 요청 하나를 나눠 쓴다. 전에는 각각 다른 경로로 받았는데 그 넷은 04 에
 * 없는 프론트 전용 경로였다.
 *
 * `mentions` 는 멘션·댓글·답글 알림이고 알림함과 같은 모양이다(`features/notifications`).
 * `posts` 는 최근 공지. 권한 밖이면 서버가 제목을 가리고 `masked` 를 세운다.
 */
export type HomeData = Omit<Schema<'HomeOut'>, 'mentions' | 'posts'> & {
  mentions: Notification[]
  posts: HomePost[]
}

/** 백엔드 `routers/me.py` 의 `NonBlank`. 할 일 글자 수 상한. */
export const TODO_TEXT_MAX = 500

/** 오늘 할 일. 백엔드 `routers/me.py` 의 `TodoOut` 과 같다. */
export type TodayTask = Schema<'TodoOut'>

/**
 * 내 개인 일정(홈 캘린더). 04 에 없는 개념이라 `/me/todos`(§2)와 같은 꼴로 `/me/events` 를 가정했다(PR 본문).
 * 하루 단위. 시각은 선택이고 `HH:MM`.
 */
export interface CalendarEvent {
  id: string
  /** `2026-09-08` */
  date: string
  title: string
  time: string | null
  created_at: string
}

export interface CalendarEventInput {
  date: string
  title: string
  time?: string | null
}
