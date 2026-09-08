import type { AiScope, AiTemplate } from './types'

/** 템플릿은 프롬프트를 채울 뿐이라 서버가 필요 없다. `POST /ai/template`(501) 이 붙으면 그쪽으로. */
export const AI_TEMPLATES: AiTemplate[] = [
  {
    id: 't-minutes',
    label: '회의록 초안',
    prompt: '오늘 회의 내용을 회의록 형식으로 정리해줘. 참석자·논의·결정사항·다음 할 일 순서로.',
  },
  {
    id: 't-weekly',
    label: '주간 보고서',
    prompt: '이번 주 진행 상황을 주간 보고서로 작성해줘. 완료·진행중·다음주 계획으로 나눠서.',
  },
  {
    id: 't-notice',
    label: '공지문',
    prompt: '전사 공지문 초안을 써줘. 제목, 대상, 일정, 문의처가 들어가게.',
  },
]

/**
 * 지식 소스. 04 §8 의 `scope` 어휘는 미정이라 이 값은 제안이다. `all` 은 보내지 않는다.
 * 권한 판정은 여기 없다: 권한 밖 문서는 서버가 RAG 단계에서 근거에서 뺀다(FR-AI-05).
 */
export const AI_SCOPES: AiScope[] = [
  { id: 'all', label: '전체 위키' },
  { id: 'wiki', label: '회사 위키' },
  { id: 'hr', label: '인사·총무 규정' },
  { id: 'exec', label: '경영 문서' },
]
