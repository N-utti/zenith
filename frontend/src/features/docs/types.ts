/** 백엔드 `routers/docs.py` 의 `Person`. */
export interface Person {
  id: string
  name: string
}

/**
 * 폴더. 백엔드 `FolderOut` 과 같은 모양이다.
 *
 * 문서는 문서 안에 들어가지 않는다. **폴더가 폴더를 담고, 문서는 폴더에만 담긴다.**
 * 이전에는 문서끼리 `parentId` 로 겹쳐 두었는데 서버에는 그런 관계가 없다.
 */
export interface Folder {
  id: string
  parent_id: string | null
  title: string
  /** 같은 부모 안에서의 순서. 작은 것이 위. */
  sort: number
}

export interface DocSummary {
  id: string
  folder_id: string
  title: string
  updated_at: string
  /** 마지막으로 손댄 사람. 계정이 지워졌으면 `null`. */
  updated_by: Person | null
  /** 휴지통에 들어간 시각. 살아 있는 문서는 `null`. */
  deleted_at: string | null
}

/** 사이드바 트리 한 벌(`GET /tree`). 폴더와 문서를 따로 준다. */
export interface DocTreeData {
  folders: Folder[]
  docs: DocSummary[]
}

/** 업로드 결과. 문서에는 바이너리가 아니라 이 url만 들어간다. */
export interface UploadedFile {
  id: string
  url: string
  name: string
  size: number
}

export interface DocComment {
  id: string
  authorId: string
  authorName: string
  authorHue: number
  body: string
  createdAt: string
}

/**
 * 버전 목록에 실리는 것. 백엔드 `VersionMeta` 와 같다.
 *
 * **스냅샷이 없다.** 한 건은 작아도 버전이 쌓인 문서에서는 목록 한 번에 전부 실리기 때문이다
 * (`backend/app/routers/docs.py` 의 `VersionOut` 주석). 내용은 `POST /docs/{id}/restore` 로
 * 그 버전 하나만 받는다.
 */
export interface DocVersion {
  id: string
  created_at: string
  /** 계정이 지워졌으면 `null`. */
  author: Person | null
  /** 되돌리기처럼 이유가 분명한 버전에만 붙는다. 붙으면 병합되지 않는다. */
  label: string | null
}

/** 스냅샷까지 실린 버전. 백엔드 `VersionOut`(버전 저장과 `/restore` 의 응답). */
export interface DocVersionSnapshot extends DocVersion {
  /** Yjs 스냅샷(base64). 내용 사본이 아니라 시점 표식이다. */
  snapshot: string
}

export interface DocDetail extends DocSummary {
  /**
   * 서버가 보관한 Yjs 상태(base64). 아직 릴레이가 영속화하기 전이면 `null`.
   * 지금 화면은 읽지 않는다. 본문 연동을 붙일 때 `seedHtml` 대신 이쪽을 쓴다.
   */
  ydoc: string | null
  /**
   * 이 문서를 처음 여는 탭에서만 쓰는 초안.
   *
   * 본문의 원천은 Y.Doc이고 서버는 목록용 메타만 들고 있다. 실제 백엔드에서는
   * 서버가 보관한 Yjs 초기 상태가 이 자리를 대신하므로 이 필드는 사라진다.
   */
  seedHtml?: string
}

/**
 * 새 문서를 열며 `navigate('/docs/:id', { state })` 로 실어 보내는 초안. AI 답변 "문서로 저장"이 쓴다.
 * 서버 `POST /docs` 가 본문을 받지 않아(backend/README §3 (d)) 초안은 브라우저가 Y.Doc 에 심는다.
 */
export interface DocSeedState {
  seedHtml: string
  title: string
}
