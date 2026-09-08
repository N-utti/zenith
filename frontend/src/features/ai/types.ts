/** 04 §8 `GET /ai/models` 항목. Ollama 태그 모양을 유지한다(Claude 는 size 가 null). */
export interface AiModel {
  name: string
  size: number | null
}

/**
 * 04 §8 `event: citations` 항목. 번호(`n`)는 본문의 `[[n]]` 표식과 짝을 이룬다(§8.1).
 *
 * 권한 밖 문서는 애초에 이 배열에 들어오지 않는다. 목록에서 마스킹하는 게시판과 달리,
 * 근거는 존재 자체를 드러내면 안 된다. 인용문이 곧 본문 유출이기 때문이다.
 */
export interface Citation {
  n: number
  doc_id: string
  title: string
  /** 답변의 근거가 된 구절. 문서 본문에서 그대로 따온다. */
  quote: string
  /** "인사·총무 규정 · 2.1 장비" 같은 위치 표기 */
  path: string
}

export interface AiMessage {
  id: string
  role: 'user' | 'assistant'
  /** 본문. assistant 답변은 `[[1]]` 형태의 각주 표식을 포함할 수 있다. 스트리밍 중에는 자라난다. */
  body: string
  createdAt: string
  citations?: Citation[]
  /** 스트림 도중 서버가 `event: error` 를 보냈을 때의 사유. 받은 데까지의 본문은 남긴다. */
  error?: string
}

/** 컴포저에 프롬프트를 채워 주는 자동작성 템플릿. */
export interface AiTemplate {
  id: string
  label: string
  prompt: string
}

/** `POST /ai/chat` 의 `scope`. 04 는 문자열 하나만 정했고 어휘는 아직 없다(PR 본문에 제안). */
export interface AiScope {
  id: string
  label: string
}
