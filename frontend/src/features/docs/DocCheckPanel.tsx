import { useState } from 'react'
import type { Editor } from '@tiptap/react'
import { useMutation } from '@tanstack/react-query'
import { ScanSearch } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ExcludedNote, SourceCard } from '@/features/ai/SourcesPanel'
import { api } from '@/lib/api'
import type { Schema } from '@/types'

type Claim = Schema<'Claim'>
type CheckResult = Schema<'CheckOut'> & { truncated: boolean }

/** 서버 상한(`CheckIn.text`). 넘으면 앞부분만 보낸다. */
const MAX_TEXT = 50000

const VERDICT: Record<Claim['verdict'], { label: string; tone: 'success' | 'danger' | 'neutral' }> =
  {
    match: { label: '일치', tone: 'success' },
    mismatch: { label: '불일치', tone: 'danger' },
    unverified: { label: '확인 불가', tone: 'neutral' },
  }

/** 상한에서 자를 자리. 이모지처럼 두 칸짜리 글자의 앞 절반에서 자르면 짝 없는 글자가 나가 공급자 요청이 깨진다. */
function cutAt(text: string): number {
  const code = text.charCodeAt(MAX_TEXT - 1)
  return code >= 0xd800 && code <= 0xdbff ? MAX_TEXT - 1 : MAX_TEXT
}

/**
 * 이 문서의 주장을 규정 전문·사내 자료와 대조한다(백엔드 #382 `POST /ai/check`). 결과는 서버에 남지 않는다.
 *
 * 문서 id 가 아니라 편집기의 글을 보낸다. 서버가 문서 id 로 읽는 본문은 마지막 저장분이라 방금 고친 글이
 * 빠지고, 주장의 원문 발췌(`span`)가 지금 화면의 글과 어긋나 그 자리로 갈 수 없게 된다.
 * 글을 보내면 서버는 'AI 근거로 쓰기' 스위치를 보지 않는다. 꺼진 문서는 여기서 막는다(문서 id 로 보내면 422 인 것과 맞춘다).
 *
 * 다른 탭을 보는 동안에도 숨긴 채 살아 있다. 검사는 오래 걸려(최대 2분) 탭을 옮겼다 와도 결과가 남아야 한다.
 */
export function DocCheckPanel({
  editor,
  aiSource,
  onJump,
}: {
  editor: Editor | null
  aiSource: boolean
  /** 본문에서 그 글을 찾아 간다. 못 찾으면(검사 뒤 고쳤거나 두 블록에 걸침) `false`. */
  onJump: (text: string) => boolean
}) {
  // 다시 검사하는 동안(최대 2분)과 실패했을 때도 앞 결과를 남긴다. `check.data` 는 새 요청에서 비워진다.
  const [result, setResult] = useState<CheckResult | null>(null)
  const check = useMutation({
    mutationFn: async (): Promise<CheckResult> => {
      const text = editor?.getText().trim() ?? ''
      if (!text) throw new Error('본문이 비어 있습니다.')
      const out = await api<Schema<'CheckOut'>>('/ai/check', {
        method: 'POST',
        body: JSON.stringify({ text: text.slice(0, cutAt(text)) }),
      })
      return { ...out, truncated: text.length > MAX_TEXT }
    },
    onSuccess: setResult,
  })
  /** 본문에서 찾지 못한 주장의 번호. 그 카드에 안내를 단다. */
  const [missing, setMissing] = useState<number | null>(null)
  const run = () => {
    setMissing(null)
    check.mutate()
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto p-3">
        {result ? (
          <>
            {/* 검사는 오래 걸린다. 결과가 오면 화면 낭독기가 이 줄을 읽어 알린다. */}
            <p role="status" className="text-subtle mb-3 text-[11px] leading-relaxed">
              AI 판정입니다. 근거 카드를 직접 확인하세요.
              {result.truncated && ' 본문이 길어 앞 5만 자만 검사했습니다.'}
            </p>
            {result.claims.length === 0 ? (
              <p className="text-subtle py-6 text-center text-xs">
                검사할 만한 주장을 찾지 못했습니다.
              </p>
            ) : (
              <ul className="space-y-3">
                {result.claims.map((claim) => (
                  <li key={claim.n} className="border-line bg-surface rounded-xl border p-3">
                    <div className="flex items-start gap-2">
                      <Badge tone={VERDICT[claim.verdict].tone} className="mt-px shrink-0">
                        {VERDICT[claim.verdict].label}
                      </Badge>
                      {/* 원문 발췌가 없으면(서버가 원문에서 못 찾음) 갈 곳이 없어 글로만 둔다. */}
                      {claim.span ? (
                        <button
                          type="button"
                          onClick={() => setMissing(onJump(claim.span) ? null : claim.n)}
                          className="text-fg cursor-pointer text-left text-[13px] leading-snug hover:underline"
                        >
                          {claim.claim}
                        </button>
                      ) : (
                        <p className="text-fg text-[13px] leading-snug">{claim.claim}</p>
                      )}
                    </div>
                    {missing === claim.n && (
                      <p role="status" className="text-subtle mt-1.5 text-[11px]">
                        본문에서 이 문장을 찾지 못했습니다. 검사 뒤에 고쳤다면 다시 검사하세요.
                      </p>
                    )}
                    {claim.note && (
                      <p className="text-muted mt-1.5 text-xs leading-relaxed">{claim.note}</p>
                    )}
                    {claim.citations.length > 0 && (
                      <ul className="mt-2.5 space-y-2">
                        {claim.citations.map((source) => (
                          <li key={source.n}>
                            <SourceCard source={source} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4 px-1">
              <ExcludedNote />
            </div>
          </>
        ) : (
          <p className="text-subtle px-1 py-6 text-center text-xs leading-relaxed">
            본문의 주장을 사내 규정과 문서에 대조합니다.
            <br />
            주장을 누르면 본문의 그 문장으로 갑니다.
          </p>
        )}
      </div>

      {/* 너무 잦음(429)·시간 초과·출력 깨짐(503)은 서버가 그대로 보여 줄 문구를 준다. */}
      {check.isError && (
        <p role="alert" className="text-danger px-4 pb-2 text-center text-xs">
          {check.error.message || '검사하지 못했습니다. 다시 시도해 주세요.'}
        </p>
      )}

      <div className="border-line shrink-0 border-t p-3">
        {aiSource ? (
          <Button
            className="w-full"
            onClick={run}
            disabled={!editor || check.isPending}
            aria-busy={check.isPending}
          >
            <ScanSearch className="size-4" />
            {check.isPending ? '검사 중' : result ? '다시 검사' : '이 문서 검사'}
          </Button>
        ) : (
          <p className="text-subtle text-center text-xs leading-relaxed">
            이 문서는 AI 근거로 쓰기가 꺼져 있어 검사할 수 없습니다.
            <br />
            상단 줄의 AI 아이콘으로 켤 수 있습니다.
          </p>
        )}
      </div>
    </div>
  )
}
