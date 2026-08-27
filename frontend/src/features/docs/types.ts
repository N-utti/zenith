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

export interface DocVersion {
  id: string
  createdAt: string
  authorId: string
  authorName: string
  authorHue: number
  /** Yjs 스냅샷(base64). 내용 사본이 아니라 시점 표식이다. */
  snapshot: string
  /** 되돌리기처럼 이유가 분명한 버전에만 붙는다. 붙으면 병합되지 않는다. */
  label?: string
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
