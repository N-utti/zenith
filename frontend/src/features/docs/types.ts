export interface DocSummary {
  id: string
  title: string
  updatedAt: string
  /** 마지막으로 손댄 사람. 목록에서 아바타로 보여준다. */
  editorName: string
  editorHue: number
}

export interface DocComment {
  id: string
  authorId: string
  authorName: string
  authorHue: number
  body: string
  createdAt: string
}

export interface DocDetail extends DocSummary {
  /**
   * 이 문서를 처음 여는 탭에서만 쓰는 초안.
   *
   * 본문의 원천은 Y.Doc이고 서버는 목록용 메타만 들고 있다. 실제 백엔드에서는
   * 서버가 보관한 Yjs 초기 상태가 이 자리를 대신하므로 이 필드는 사라진다.
   */
  seedHtml?: string
}
