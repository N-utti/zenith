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
 * 폴더로 범위를 좁힌 질문(`scoped`)은 게시글을 근거로 쓰지 않는다(백엔드 #372).
 * 실제 서버는 그 폴더 아래 문서만 찾지만, 목은 어느 폴더를 골라도 문서 근거가 같다.
 */
export function answer(user: User, scoped = false): { body: string; citations: Citation[] } {
  const citations = ALL_CITATIONS.filter(
    (c) =>
      (!c.minRole || ROLE_RANK[user.role] >= ROLE_RANK[c.minRole]) &&
      !(scoped && c.type === 'post'),
  ).map(({ n, doc_id, type, to, title, quote, path }) => ({
    n,
    doc_id,
    type,
    to,
    title,
    quote,
    path,
  }))
  // 빠진 근거의 각주는 달지 않는다. 자리(순서)가 아니라 번호로 찾아야 남은 각주가 밀리지 않는다.
  const mark = (n: number) => (citations.some((c) => c.n === n) ? `[[${n}]]` : '')
  // 실제 모델처럼 마크다운(굵게·목록·줄바꿈)으로 답한다. 말풍선이 글자 그대로 보이던 #393 을 목에서도 본다.
  return {
    body:
      `신규 입사자는 **입사 첫날** 사양에 맞춰 노트북을 지급받습니다.\n\n` +
      `- **개발 직군**: 고사양\n- **그 외 직군**: 표준 사양${mark(1)}\n\n` +
      `반납은 퇴사 시 총무팀에 하도록 규정되어 있습니다${mark(2)}.\n` +
      `지급받은 장비로 2주 동안 협업툴 파일럿에 참여할 수 있고${mark(3)}, 직군별 사양은 첨부된 사양표에 있습니다${mark(4)}.` +
      (mark(5) ? ` 내년 장비 예산은 인당 상향을 검토 중입니다${mark(5)}.` : ''),
    citations,
  }
}

/**
 * 문서 하나를 놓고 물었을 때(`scope: "doc:<id>"`, 백엔드 #380). 서버는 그 본문 앞 1,000자를 근거 카드로 준다.
 * 본문(Y.Doc)은 브라우저에만 있어 목은 제목으로 모양만 재현한다.
 */
export function docAnswer(doc: { id: string; title: string }): {
  body: string
  citations: Citation[]
} {
  return {
    body: `${doc.title} 문서를 기준으로 답합니다. 본문에 따르면 질문하신 내용은 이 문서의 앞부분에 정리되어 있습니다[[1]].`,
    citations: [
      {
        n: 1,
        doc_id: doc.id,
        type: 'doc',
        to: `/docs/${doc.id}`,
        title: doc.title,
        quote: `${doc.title} 문서의 본문 앞부분(목). 실제 서버는 본문 앞 1,000자를 보냅니다.`,
        path: doc.title,
      },
    ],
  }
}

export const DOC_ACTIONS = [
  'summarize',
  'continue',
  'polish',
  'translate',
  'table',
  'cite',
  'conform',
] as const

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
    // 근거 동작(백엔드 #385)은 문서 전체를 다시 쓴다. 목은 본문을 몰라 문장 하나로 모양만 낸다.
    // 그래서 고치기 결과는 화면에서 원문 전체가 바뀐 한 묶음으로 보이고 바꾸기 버튼은 본문을 못 찾는다.
    case 'cite':
      return `「${title}」은 사내 규정을 따릅니다.[[1]]`
    case 'conform':
      return `수습 기간은 3개월입니다.[[1]]`
  }
}

/** 근거 동작의 각주 카드. 다른 다섯 동작은 빈 목록이다(`DocActionOut.citations`). */
export function docActionCitations(action: (typeof DOC_ACTIONS)[number]): Citation[] {
  if (action !== 'cite' && action !== 'conform') return []
  return [
    {
      n: 1,
      doc_id: null,
      type: 'doc',
      title: '취업규칙',
      quote: '제10조(수습) 신규 입사자의 수습 기간은 3개월로 한다.',
      path: '취업규칙 · 제10조',
    },
  ]
}

/**
 * 팩트체크(`POST /ai/check`, 백엔드 #382). 실제로는 Claude 가 글의 주장을 뽑아 근거와 대조한다.
 * 목은 판정 세 가지의 모양만 재현한다: 앞 두 문장을 일치·불일치로, 원문 발췌가 없는 확인 불가 하나.
 * 원문 발췌(`span`)는 보낸 글에서 그대로 자른 것이라 화면이 본문에서 찾을 수 있다.
 */
export function checkClaims(text: string, web = false) {
  const sentences = text
    .split(/\n+|(?<=[.?!])\s+/)
    .map((s) => s.trim().slice(0, 120))
    .filter(Boolean)
  const cite = (c: Citation) => ({
    n: 1,
    doc_id: c.doc_id,
    type: 'doc' as const,
    to: `/docs/${c.doc_id}`,
    title: c.title,
    quote: c.quote,
    path: c.path,
  })
  const claims: {
    n: number
    claim: string
    span: string
    verdict: 'match' | 'mismatch' | 'unverified'
    note: string
    citations: Citation[]
  }[] = []
  if (sentences[0]) {
    claims.push({
      n: claims.length + 1,
      claim: sentences[0],
      span: sentences[0],
      verdict: 'match',
      note: '규정의 지급 기준과 같습니다.',
      citations: [cite(ALL_CITATIONS[0])],
    })
  }
  if (sentences[1]) {
    claims.push({
      n: claims.length + 1,
      claim: sentences[1],
      span: sentences[1],
      verdict: 'mismatch',
      note: '규정은 반납처를 총무팀으로 정합니다. 글의 내용과 다릅니다.',
      citations: [cite(ALL_CITATIONS[1])],
    })
  }
  // 웹도 찾기(백엔드 #388)를 켜면 사내 자료로 못 찾던 주장이 웹 출처로 확인된다. 웹 카드의 `to` 는 바깥 절대 주소다.
  claims.push(
    web
      ? {
          n: claims.length + 1,
          claim: '지급 장비의 사양은 해마다 바뀐다.',
          span: '',
          verdict: 'match',
          note: '공개된 정부 조달 기준에서 같은 내용을 찾았습니다.',
          citations: [
            {
              n: 3,
              type: 'web',
              to: 'https://www.korea.kr/news/policyNewsView.do?newsId=1',
              title: '공공기관 업무용 장비 조달 기준',
              quote: '업무용 장비 사양 기준은 매년 고시한다.',
              path: 'www.korea.kr',
            },
          ],
        }
      : {
          n: claims.length + 1,
          claim: '지급 장비의 사양은 해마다 바뀐다.',
          span: '',
          verdict: 'unverified',
          note: '근거 번호가 없어 확인 불가로 둔다. 사내 자료에서 사양 변경 주기를 찾지 못했습니다.',
          citations: [],
        },
  )
  return { claims }
}
