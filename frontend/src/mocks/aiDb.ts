import type { AiModel, Citation } from '@/features/ai/types'
import { ROLE_RANK, type User } from '@/types'

/** 04 §8 `GET /ai/models`. 실제 서버는 설정된 Claude 모델 하나를 준다. */
export const AI_MODELS: AiModel[] = [{ name: 'claude-opus-5', size: null }]

/** 권한과 무관하게 존재하는 근거 후보. 응답을 만들 때 등급으로 걸러진다. */
const ALL_CITATIONS: (Citation & { minRole?: 'lead' | 'exec' })[] = [
  {
    n: 1,
    doc_id: 'd-1',
    title: '비품·장비 지급 규정',
    quote: '직군별 사양 기준에 따라 입사 시 노트북을 지급하며, 개발 직군은 고사양을 기본으로 한다.',
    path: '인사·총무 규정 · 2.1 장비',
  },
  {
    n: 2,
    doc_id: 'd-0',
    title: '퇴사 절차 안내',
    quote: '퇴사 시 지급 장비는 총무팀에 반납한다.',
    path: '회사 위키 · 온보딩/오프보딩',
  },
  // 게시글 근거는 실제 서버가 이 모양으로 준다(백엔드 #366). 그 아래 첨부 파일은 아직 주지 않는다.
  {
    n: 3,
    type: 'post',
    to: '/board/all/p-2',
    title: '제니스 사내 협업툴 파일럿 참여자 모집',
    quote: '기간은 2주이며, 기존 업무 방식과 병행합니다.',
    path: '전체 공지',
  },
  {
    n: 4,
    type: 'file',
    doc_id: 'd-1',
    to: '/docs/d-1',
    title: '장비 사양표.xlsx',
    quote: '개발 직군: 메모리 32GB 이상, 저장 장치 1TB.',
    path: '비품·장비 지급 규정 · 첨부',
  },
  {
    n: 5,
    doc_id: 'd-2',
    title: '2027 장비 예산 계획',
    quote: '내년 장비 교체 예산은 전사 기준 인당 상향을 검토한다.',
    path: '경영 문서 · 예산',
    minRole: 'exec',
  },
]

/**
 * 목 답변. 실제로는 Claude 가 RAG 근거로 답한다.
 * 여기서는 "각주가 붙고 권한 밖 문서는 근거에서 빠진다"는 규약만 재현한다.
 * minRole 은 서버 안에서만 쓰는 판정 기준이라 응답에 싣지 않는다.
 */
export function answer(user: User): { body: string; citations: Citation[] } {
  const citations = ALL_CITATIONS.filter(
    (c) => !c.minRole || ROLE_RANK[user.role] >= ROLE_RANK[c.minRole],
  ).map(({ n, doc_id, type, to, title, quote, path }) => ({
    n,
    doc_id,
    type,
    to,
    title,
    quote,
    path,
  }))
  const marks = citations.map((c) => `[[${c.n}]]`)
  return {
    body:
      `신규 입사자는 입사 첫날 사양에 맞춰 노트북을 지급받습니다. 개발 직군은 고사양, 그 외 직군은 표준 사양이 기본이며${marks[0] ?? ''}, ` +
      `반납은 퇴사 시 총무팀에 하도록 규정되어 있습니다${marks[1] ?? ''}. ` +
      `지급받은 장비로 2주 동안 협업툴 파일럿에 참여할 수 있고${marks[2] ?? ''}, 직군별 사양은 첨부된 사양표에 있습니다${marks[3] ?? ''}.` +
      (marks[4] ? ` 내년 장비 예산은 인당 상향을 검토 중입니다${marks[4]}.` : ''),
    citations,
  }
}

export const DOC_ACTIONS = ['summarize', 'continue', 'polish', 'translate', 'table'] as const

/**
 * 문서 안 인라인 AI(04 §8 `/ai/doc-action`). 위키 RAG 가 아니라 **그 문서 본문**을 근거로 쓴다.
 * 본문(Y.Doc)은 브라우저에만 있어 목은 제목만 안다. 동작별 모양만 재현한다.
 */
export function docActionDraft(action: (typeof DOC_ACTIONS)[number], title: string): string {
  switch (action) {
    case 'summarize':
      return `「${title}」의 핵심은 세 가지입니다. 배경, 결정 사항, 다음 할 일.`
    case 'continue':
      return '앞 내용에 이어, 다음 단계에서 확인할 항목과 담당을 정리합니다.'
    case 'polish':
      return `「${title}」의 문장을 다듬어 군더더기를 덜어냈습니다.`
    case 'table':
      return '| 항목 | 내용 | 담당 |\n| --- | --- | --- |\n| 정리 대상 | 위 본문 | 미정 |'
    case 'translate':
      return `[EN] ${title}`
  }
}
