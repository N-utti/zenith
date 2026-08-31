import type { Role } from '@/types'

/**
 * 답변의 근거 문서. 번호(`n`)는 본문의 `[[n]]` 표식과 짝을 이룬다.
 *
 * 권한 밖 문서는 애초에 이 배열에 들어오지 않는다 — 목록에서 마스킹하는 게시판과 달리,
 * 근거는 존재 자체를 드러내면 안 된다. 인용문이 곧 본문 유출이기 때문이다.
 */
export interface SourceDoc {
  id: string
  n: number
  title: string
  /** 답변의 근거가 된 구절. 문서 본문에서 그대로 따온다. */
  quote: string
  /** "인사·총무 규정 · 2.1 장비" 같은 위치 표기 */
  path: string
  /** 열 수 있는 문서면 문서 id. 규정처럼 앱 밖 문서면 없다. */
  docId?: string
}

export interface AiMessage {
  id: string
  role: 'user' | 'assistant'
  /** 본문. assistant 답변은 `[[1]]` 형태의 각주 표식을 포함할 수 있다. */
  body: string
  createdAt: string
  sources?: SourceDoc[]
  /** 권한 때문에 근거에서 제외된 문서 수. 0이면 표시하지 않는다. */
  excludedCount?: number
}

export interface KnowledgeSource {
  id: string
  label: string
  /** 이 등급 미만은 흐리게 보이고 선택할 수 없다. */
  minRole?: Role
  /** 서버가 내 등급으로 판정해 내려준다. 프론트가 계산하지 않는다. */
  allowed: boolean
}

export interface AiModel {
  id: string
  label: string
  note: string
}

/** 컴포저에 프롬프트를 채워 주는 자동작성 템플릿. */
export interface AiTemplate {
  id: string
  label: string
  prompt: string
}

export interface RecentQuestion {
  id: string
  text: string
  askedAt: string
}

export interface AiMeta {
  models: AiModel[]
  sources: KnowledgeSource[]
  templates: AiTemplate[]
  recent: RecentQuestion[]
}
