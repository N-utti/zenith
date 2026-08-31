import type { Role } from '@/types'

export interface Announcement {
  id: string
  title: string
  /** 게시판 등급. */
  boardLevel: Role
  authorName: string
  createdAt: string
  pinned: boolean
  /**
   * 열람 권한 밖의 글. 목록에서 지우지 않고 제목을 가린 채 남긴다 —
   * PRD 성공 기준이 "제목 마스킹 + 본문 API 403"이지 "목록에서 제외"가 아니다.
   */
  masked?: boolean
}

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
