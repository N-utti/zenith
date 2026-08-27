import type { Role } from '@/types'

export interface Announcement {
  id: string
  title: string
  /** 게시판 등급. 이 등급 밖 글은 서버가 애초에 내려주지 않는다. */
  boardLevel: Role
  authorName: string
  createdAt: string
  pinned: boolean
}
