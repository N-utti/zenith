import { createContext, use, type ReactNode } from 'react'
import Markdown, { type Components, type Options } from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { cn } from '@/lib/cn'

/** 각주 상태. 근거 목록에 있는 번호만 버튼이 되고, 나머지는 배지로 남는다. */
export interface CiteState {
  has: (n: number) => boolean
  activeN: number | null
  onCite: (n: number) => void
}

const CiteContext = createContext<CiteState | null>(null)

const CITE = /^#cite-(\d+)$/
/** 사내 경로. `//host`·`/\host` 는 바깥 주소라 뺀다. */
const INTERNAL = /^\/(?![/\\])/

/** `[[n]]` 를 `[n](#cite-n)` 로. 바로 앞의 `!` 는 이스케이프한다(`확인하세요![[1]]` 가 그림 문법이 된다). */
const toCiteLinks = (text: string) =>
  text.replace(
    /(!?)\[\[(\d+)\]\]/g,
    (_, bang: string, n: string) => `${bang && '\\!'}[${n}](#cite-${n})`,
  )

/**
 * 링크. `[[n]]` 각주는 렌더 전에 `[n](#cite-n)` 링크가 되어 여기서 배지로 돌아온다.
 *
 * 링크로 남기는 건 사내 경로(`/docs/…`)뿐이다. 바깥 주소는 이름 뒤에 실제 주소를 글자로 붙인다.
 * AI 답변에는 근거 문서에 심어 둔 글이 섞일 수 있어, 평범한 이름 뒤에 문서 내용을 쿼리로 실은
 * 바깥 주소를 숨긴 링크가 생길 수 있다(누르면 사내망 밖으로 나간다). `//host` 는 바깥 주소다.
 * `javascript:` 같은 주소는 react-markdown 기본 `urlTransform` 이 먼저 비운다.
 */
function Anchor({ href, children }: { href?: string; children?: ReactNode }) {
  const cite = use(CiteContext)
  if (!href) return <>{children}</>
  const match = CITE.exec(href)
  if (!match) {
    if (!INTERNAL.test(href)) {
      return children === href ? (
        <>{href}</>
      ) : (
        <>
          {children} ({href})
        </>
      )
    }
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    )
  }
  const n = Number(match[1])
  const badge = 'ml-0.5 rounded px-1 py-0.5 align-super text-[11px] font-bold'
  if (!cite?.has(n)) {
    return <sup className={cn(badge, 'bg-sunken text-muted')}>{n}</sup>
  }
  return (
    <button
      type="button"
      onClick={() => cite.onCite(n)}
      aria-label={`근거 ${n} 보기`}
      className={cn(
        badge,
        'cursor-pointer transition-colors',
        n === cite.activeN ? 'bg-accent-soft text-accent' : 'bg-sunken text-muted hover:text-fg',
      )}
    >
      {n}
    </button>
  )
}

// 모듈 상수로 둔다. 렌더마다 새 함수를 넘기면 React 가 다른 컴포넌트로 보고 각주 버튼을 새로 만들어
// 누른 버튼의 초점이 날아간다.
const components: Components = {
  a: Anchor,
  // 바깥 그림은 부르지 않는다(백엔드 README 37(f), 사내망 밖 요청 금지). 대체 글만 남긴다.
  img: ({ alt }) => <>{alt}</>,
  // 넓은 표는 말풍선 안에서 가로로 구른다. tiptap 은 모르는 div 를 건너뛰고 표만 읽는다.
  table: ({ children }) => (
    <div className="overflow-x-auto">
      <table>{children}</table>
    </div>
  ),
}

// 줄바꿈 한 번도 줄을 바꾼다. 모델은 빈 줄 없이 줄만 바꿔 쓰는 일이 많고, 표준 마크다운은 그걸 한 줄로 붙인다.
// 물결표 하나는 취소선으로 읽지 않는다. 한국어 답변의 범위 표기(`9~18시, 12~13시`)가 취소선이 된다.
const PLUGINS: Options['remarkPlugins'] = [[remarkGfm, { singleTilde: false }], remarkBreaks]

/**
 * AI 가 쓴 마크다운을 그린다(이슈 #393). AI 출력은 믿을 수 없는 글로 본다:
 * raw HTML 은 그리지 않고(react-markdown 기본: `<br>` 까지 태그가 글자로 보인다), 바깥 주소는 링크로
 * 만들지 않고(`Anchor`), 그림은 부르지 않는다.
 *
 * `className` 이 있으면 문서 편집기 본문 모양(`.zenith-editor`)으로 감싼다. 없으면 감싸지 않는다
 * (편집기에 넣을 HTML 을 만들 때, `markdownToHtml`).
 */
export function AiMarkdown({
  text,
  className,
  cite,
}: {
  text: string
  className?: string
  cite?: CiteState
}) {
  const body = (
    // 일부러 깊게 겹친 마크다운(`>` 수천 개 등)은 파서의 호출 스택을 넘긴다. 그 답변만 원문 글자로 보인다.
    <ErrorBoundary fallback={<p className="whitespace-pre-wrap">{text}</p>}>
      <CiteContext value={cite ?? null}>
        <Markdown remarkPlugins={PLUGINS} components={components}>
          {toCiteLinks(text)}
        </Markdown>
      </CiteContext>
    </ErrorBoundary>
  )
  return className === undefined ? (
    body
  ) : (
    // 편집기 CSS 의 제목 위 여백(mt-8)이 말풍선 첫 줄에 붙지 않게 첫 요소 여백을 지운다.
    <div className={cn('zenith-editor [&>:first-child]:mt-0', className)}>{body}</div>
  )
}
