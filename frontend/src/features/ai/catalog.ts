import type { AiTemplate } from './types'

/** 템플릿은 프롬프트를 채울 뿐이라 서버가 필요 없다. `POST /ai/template`(백엔드 #317)은 쓰지 않는다. */
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
