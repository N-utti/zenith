import type {
  AiMessage,
  AiModel,
  AiTemplate,
  KnowledgeSource,
  RecentQuestion,
  SourceDoc,
} from '@/features/ai/types'
import { ROLE_RANK, type User } from '@/types'

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString()
}

export const AI_MODELS: AiModel[] = [
  { id: 'moa-8b', label: '사내-LLM-8B', note: '빠름 · 기본' },
  { id: 'moa-32b', label: '사내-LLM-32B', note: '느림 · 긴 문서에 강함' },
]

/** `allowed`는 요청한 사용자의 등급으로 핸들러가 붙인다. 저장된 정의에는 없다. */
export const KNOWLEDGE_SOURCES: Omit<KnowledgeSource, 'allowed'>[] = [
  { id: 'all', label: '전체 위키' },
  { id: 'wiki', label: '회사 위키' },
  { id: 'hr', label: '인사·총무 규정' },
  { id: 'exec', label: '경영 문서', minRole: 'exec' },
]

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

export const RECENT_QUESTIONS: RecentQuestion[] = [
  { id: 'q-1', text: '신입 온보딩 때 노트북 지급 정책이 어떻게 되나요?', askedAt: minutesAgo(4) },
  { id: 'q-2', text: '휴가 신청은 며칠 전까지 올려야 하나요?', askedAt: minutesAgo(220) },
  { id: 'q-3', text: '경조사 지원 규정 알려줘', askedAt: minutesAgo(1500) },
]

/** 권한과 무관하게 존재하는 근거 후보. 응답을 만들 때 등급으로 걸러진다. */
const ALL_SOURCES: (SourceDoc & { minRole?: 'lead' | 'exec' })[] = [
  {
    id: 's-1',
    n: 1,
    title: '비품·장비 지급 규정',
    quote: '직군별 사양 기준에 따라 입사 시 노트북을 지급하며, 개발 직군은 고사양을 기본으로 한다.',
    path: '인사·총무 규정 · 2.1 장비',
  },
  {
    id: 's-2',
    n: 2,
    title: '퇴사 절차 안내',
    quote: '퇴사 시 지급 장비는 총무팀에 반납한다.',
    path: '회사 위키 · 온보딩/오프보딩',
    docId: 'd-0',
  },
  {
    id: 's-3',
    n: 3,
    title: '2027 장비 예산 계획',
    quote: '내년 장비 교체 예산은 전사 기준 인당 상향을 검토한다.',
    path: '경영 문서 · 예산',
    minRole: 'exec',
  },
]

const SEED_ANSWER =
  '신규 입사자는 입사 첫날 사양에 맞춰 노트북을 지급받습니다. 개발 직군은 고사양, 그 외 직군은 표준 사양이 기본이며[[1]], 반납은 퇴사 시 총무팀에 하도록 규정되어 있습니다[[2]].'

/**
 * 대화는 사용자별로 따로 쌓인다. 실제 서버도 같은 모양이 된다 —
 * 근거 필터가 사용자 등급에 걸리므로 대화를 공유할 수 없다.
 */
const conversations = new Map<string, AiMessage[]>()

let nextId = 1

function visibleSources(user: User): SourceDoc[] {
  return ALL_SOURCES.filter(
    (source) => !source.minRole || ROLE_RANK[user.role] >= ROLE_RANK[source.minRole],
    // minRole은 서버 안에서만 쓰는 판정 기준이라 응답에 싣지 않는다.
  ).map((source) => ({
    id: source.id,
    n: source.n,
    title: source.title,
    quote: source.quote,
    path: source.path,
    docId: source.docId,
  }))
}

function excludedCount(user: User): number {
  return ALL_SOURCES.filter(
    (source) => source.minRole && ROLE_RANK[user.role] < ROLE_RANK[source.minRole],
  ).length
}

export function listConversation(user: User): AiMessage[] {
  const existing = conversations.get(user.id)
  if (existing) return existing

  // 화면을 처음 열었을 때 빈 채로 두지 않는다 — 각주·근거 패널이 무엇인지 보여야 한다.
  const seeded: AiMessage[] = [
    {
      id: 'm-seed-1',
      role: 'user',
      body: '신입 온보딩 때 노트북 지급 정책이 어떻게 되나요?',
      createdAt: minutesAgo(4),
    },
    {
      id: 'm-seed-2',
      role: 'assistant',
      body: SEED_ANSWER,
      createdAt: minutesAgo(4),
      sources: visibleSources(user).filter((source) => source.n <= 2),
      excludedCount: excludedCount(user),
    },
  ]
  conversations.set(user.id, seeded)
  return seeded
}

/**
 * 목 응답. 실제로는 로컬 LLM이 RAG로 답한다.
 * 여기서는 "근거가 붙고 권한 밖 문서는 제외된다"는 규약만 재현한다.
 */
export function ask(user: User, prompt: string): AiMessage[] {
  const thread = listConversation(user)

  thread.push({
    id: `m-${nextId++}`,
    role: 'user',
    body: prompt,
    createdAt: new Date().toISOString(),
  })

  const sources = visibleSources(user)
  thread.push({
    id: `m-${nextId++}`,
    role: 'assistant',
    body:
      `질문하신 내용은 사내 규정에 근거해 답변드립니다. 관련 조항은 아래 근거 문서에서 확인할 수 있습니다[[1]].` +
      (sources.length > 1 ? ` 관련 절차도 함께 정리되어 있습니다[[2]].` : ''),
    createdAt: new Date().toISOString(),
    sources,
    excludedCount: excludedCount(user),
  })

  return thread
}

/**
 * 문서 안 인라인 AI. 위키 RAG가 아니라 **열려 있는 문서 본문**을 근거로 쓴다 —
 * 그래서 근거 패널이 없고, 대신 "근거: 이 문서 본문"이라고 밝힌다.
 */
export function inlineDraft(action: string, prompt: string, docText: string): string {
  const body = docText.trim().replace(/\s+/g, ' ')
  const head = body.slice(0, 120)

  switch (action) {
    case 'summarize':
      return head
        ? `${head.split('. ').slice(0, 2).join('. ')}. 핵심만 세 줄로 줄이면 이렇습니다.`
        : '요약할 본문이 아직 없습니다. 문서를 먼저 채워 주세요.'
    case 'continue':
      return '앞 내용에 이어, 다음 단계에서 확인할 항목과 담당을 정리합니다.'
    case 'polish':
      return head ? `${head} (문장을 다듬어 군더더기를 덜어냈습니다.)` : '다듬을 문장이 없습니다.'
    case 'table':
      return '| 항목 | 내용 | 담당 |\n| --- | --- | --- |\n| 정리 대상 | 위 본문 | 미정 |'
    case 'translate':
      return head ? `[EN] ${head}` : 'There is nothing to translate yet.'
    default:
      return prompt
        ? `${prompt} — 요청하신 내용을 이 문서 본문을 근거로 정리했습니다.`
        : '무엇을 도와드릴까요?'
  }
}

export function resetConversation(user: User): AiMessage[] {
  conversations.delete(user.id)
  return listConversation(user)
}
