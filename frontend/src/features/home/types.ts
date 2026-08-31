/**
 * 홈 공지 카드는 `features/board`의 `BoardPost`를 그대로 쓴다.
 * 공지는 게시판의 일부이지 별도 개념이 아니라서, 타입을 따로 두면 두 벌이 된다.
 */

/** 나를 부른 곳. 문서 댓글이면 문서로, 채널 메시지면 채널로 간다. */
export type MentionSource =
  | { kind: 'doc'; docId: string; docTitle: string; via: '댓글' | '답글' }
  | { kind: 'channel'; channelId: string; channelName: string; via: '채널 메시지' }

export interface Mention {
  id: string
  actorName: string
  actorHue: number
  /** 본문. 내 이름 앞에 붙는 @는 화면에서 따로 강조한다. */
  body: string
  mentionsMe: boolean
  source: MentionSource
  createdAt: string
}

export interface TodayTask {
  id: string
  title: string
  done: boolean
}
