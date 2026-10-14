import type { DocSeedState } from '@/features/docs/types'
import { markdownToHtml } from './markdownToHtml'

const TITLE_MAX = 200

/**
 * AI 답변을 새 문서의 초안으로 바꾼다(05 SCR-06 "문서로 저장", FR-AI-07).
 *
 * 각주 표식 `[[n]]` 은 뺀다. 근거 카드(인용문·제목)도 싣지 않는다: 근거는 묻는 사람의 등급으로
 * 걸러진 것이라 등급이 없는 문서에 옮기면 임원 문서 인용문이 전 직원에게 열린다.
 * 본문은 마크다운으로 읽어 굵게·목록·표를 문서 서식으로 옮긴다(#393). 제목은 답변을 부른 질문을
 * 한 줄로 편 것이다(서버 상한 200자, 코드포인트 단위). 이벤트 처리 안에서 부른다(`markdownToHtml`).
 */
export function answerToSeed(body: string, question: string | undefined): DocSeedState {
  const seedHtml = markdownToHtml(body.replace(/\[\[\d+\]\]/g, ''))
  const title =
    [...(question ?? '').replace(/\s+/g, ' ').trim()].slice(0, TITLE_MAX).join('') || 'AI 답변'
  return { seedHtml, title }
}
