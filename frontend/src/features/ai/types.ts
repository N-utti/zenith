import type { Schema } from '@/types'

/** 04 §8 `GET /ai/models` 항목. Ollama 태그 모양을 유지한다(Claude 는 size 가 null). */
export type AiModel = Schema<'ModelOut'>

/** `POST /ai/attachments` 응답(백엔드 #396). `chars` 는 서버가 뽑은 평문 글자 수다. */
export type AiAttachment = Schema<'app__routers__ai__AttachmentOut'>

/**
 * 04 §8 `event: citations` 항목. 번호(`n`)는 본문의 `[[n]]` 표식과 짝을 이룬다(§8.1).
 *
 * 권한 밖 문서는 애초에 이 배열에 들어오지 않는다. 목록에서 마스킹하는 게시판과 달리,
 * 근거는 존재 자체를 드러내면 안 된다. 인용문이 곧 본문 유출이기 때문이다.
 */
export interface Citation {
  n: number
  /** 문서일 때만 온다. 게시글 근거는 `null` 이다. */
  doc_id?: string | null
  /**
   * 근거의 종류와 눌렀을 때 갈 자리. 서버는 문서(`doc`)와 일반 게시글(`post`)을 준다(백엔드 #366).
   * `to` 는 통합검색의 `Hit` 과 같은 앱 안 경로다. 질문에 올린 첨부(`file`, 백엔드 #396)는 `to` 가
   * 원본 내려받기 주소(`/api/ai/attachments/{id}`)다. 둘 다 없으면 문서로 본다(`source.ts`).
   */
  type?: 'doc' | 'post' | 'file' | 'web'
  to?: string
  title: string
  /** 답변의 근거가 된 구절. 문서 본문에서 그대로 따온다. */
  quote: string
  /** "인사·총무 규정 · 2.1 장비" 같은 위치 표기 */
  path: string
}

export interface AiMessage {
  id: string
  /** 서버가 저장한 답변의 id(`done` 이벤트). 평가는 이 id 로 보내야 저장된 대화에 붙는다. */
  serverId?: string
  role: 'user' | 'assistant'
  /** 본문. assistant 답변은 `[[1]]` 형태의 각주 표식을 포함할 수 있다. 스트리밍 중에는 자라난다. */
  body: string
  createdAt: string
  /**
   * 내 질문에만. 보낼 때 고른 지식 소스(폴더 id, 전체면 `null`, 문서 질문창은 `doc:<문서 id>`).
   * 실패한 답변을 다시 받을 때 같은 범위로 보낸다.
   * 서버가 그 폴더를 없다고 거절하면 `null` 로 되돌린다(`AiPage` 의 `retry`).
   */
  scope?: string | null
  /**
   * 내 질문에만. 같이 보낸 참고 문서 id(백엔드 #394). 서버는 대화에 남기지 않아 질문마다 실어 보낸다.
   * 다시 받을 때 같은 문서로 보내고, 서버가 그중 하나라도 거절하면 비운다(`AiPage` 의 `retry`).
   */
  docs?: string[]
  /**
   * 내 질문에만. 같이 보낸 첨부 id(백엔드 #396). 참고 문서처럼 대화에 안 남아 질문마다 실어 보낸다.
   * 서버가 거절하면(7일 지나 지워짐) 비우고 다시 받는다(`AiPage` 의 `retry`).
   */
  attachments?: string[]
  citations?: Citation[]
  /** 스트림 도중 서버가 `event: error` 를 보냈을 때의 사유. 받은 데까지의 본문은 남긴다. */
  error?: string
}

/** 사용자가 누른 각주. 답변 본문의 `[[n]]` 과 근거 카드가 같은 짝으로 켜진다. */
export interface CitationFocus {
  messageId: string
  n: number
  /** 클릭 일련번호. 같은 각주를 다시 눌러도 카드로 다시 이동하게 한다. */
  tick: number
}

/** 컴포저에 프롬프트를 채워 주는 자동작성 템플릿. */
export interface AiTemplate {
  id: string
  label: string
  prompt: string
}

/** ⌘K 팔레트가 `navigate('/ai', { state })` 로 실어 보내는 검색어. 컴포저에 채우기만 하고 보내지는 않는다. */
export type AskState = { ask: string }
