import { useState, type DragEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/PageHeader'
import { Select } from '@/components/ui/Select'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { Tabs } from '@/components/ui/Tabs'
import { useToast } from '@/components/ui/ToastContext'
import { useDeals, useUpdateDeal } from '@/features/crm/api'
import { DealFormModal } from '@/features/crm/CrmForms'
import { NextAction } from '@/features/crm/DealBits'
import { ExportButton } from '@/features/crm/ExportButton'
import {
  DEAL_KIND_LABEL,
  DEAL_KINDS,
  DEAL_STAGES,
  formatEok,
  type Deal,
  type DealKind,
} from '@/features/crm/types'
import { ApiError } from '@/lib/api'
import { cn } from '@/lib/cn'

/** 끌어 옮기는 카드의 id 를 싣는 형식. 다른 곳에서 끌어 온 글자·파일은 무시한다. */
const DRAG_TYPE = 'application/x-zenith-deal'

/**
 * 마우스가 있는 기기에서만 끌기를 켠다. 아이폰 사파리는 `draggable` 요소를 길게 누르면 끌기를
 * 시작해 링크 미리보기·세로 스크롤과 부딪힌다.
 *
 * 카드의 단계 선택은 그 반대다. 끌기가 꺼진 손가락 기기에서만 보인다. 끌기가 되는 화면에
 * 같이 두면 카드마다 같은 일을 두 번 보여 줄 뿐이다. 끌기를 못 쓰는 키보드 사용자는 카드 제목으로
 * 안건 상세에 들어가 거기 단계 선택으로 옮긴다(WCAG 2.5.7 의 끌기 대안).
 */
const CAN_DRAG =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(pointer: fine)').matches

/**
 * 카드의 단계 선택(손가락 기기)으로 옮기고 나면 카드가 다른 열에 새로 그려져 초점이 사라진다. 옮긴 카드의 선택으로
 * 초점을 되돌리고, 성사로 보드에서 빠졌으면 마지막 열로 보낸다. 다시 그린 뒤에 찾도록 한 박자 미룬다.
 */
function refocus(dealId: string, fallbackStage: string) {
  requestAnimationFrame(() => {
    const target =
      document.querySelector<HTMLElement>(`[data-deal-stage="${dealId}"]`) ??
      document.querySelector<HTMLElement>(`[data-stage-column="${fallbackStage}"]`)
    target?.focus()
    target?.scrollIntoView({ block: 'nearest' })
  })
}

/**
 * 안건 파이프라인 보드(15 §10). 종류(출자 유치·투자 안건·매각)마다 단계 열이 다르다.
 *
 * 진행 중인 안건만 보인다. 성사·중단은 기관 상세의 안건 목록과 안건 상세에 남는다.
 * 데스크톱은 카드를 끌어 단계를 옮기고, 손가락은 카드 아래 단계 선택으로 옮긴다
 * (15 §10 "모바일은 선택 방식만"). 키보드는 안건 상세의 단계 선택을 쓴다.
 */
export function CrmBoardPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const requested = params.get('kind') as DealKind | null
  const kind: DealKind = requested && DEAL_KINDS.includes(requested) ? requested : 'fundraising'
  const [creating, setCreating] = useState(false)

  return (
    <>
      <PageHeader
        title="안건"
        description="출자 유치·투자·매각 안건의 진행 단계입니다. 전 직원이 함께 봅니다."
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => void navigate('/crm/orgs')}>
              기관 목록
            </Button>
            <ExportButton entity="deals" />
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="size-4" />
              안건 등록
            </Button>
          </>
        }
      />
      <Tabs
        items={DEAL_KINDS.map((key) => ({ key, label: DEAL_KIND_LABEL[key] }))}
        value={kind}
        onChange={(key) =>
          setParams(
            (prev) => {
              if (key === 'fundraising') prev.delete('kind')
              else prev.set('kind', key)
              return prev
            },
            { replace: true },
          )
        }
      >
        {(key) => <Board kind={key as DealKind} />}
      </Tabs>
      {creating && <DealFormModal kind={kind} onClose={() => setCreating(false)} />}
    </>
  )
}

function Board({ kind }: { kind: DealKind }) {
  const toast = useToast()
  const deals = useDeals({ kind, status: 'open' })
  const move = useUpdateDeal()
  /** 끌고 있는 카드 위에 떠 있는 열. 떨어뜨릴 자리를 칠해 보인다. */
  const [over, setOver] = useState<string | null>(null)
  const stages = DEAL_STAGES[kind]
  const items = deals.data?.items ?? []

  const moveTo = (deal: Deal, stage: string, fromKeyboard = false) => {
    // 앞 이동이 끝나기 전(새 version 이 오기 전)에 또 옮기면 내가 만든 409 가 난다.
    if (move.isPending || stage === deal.stage) return
    const last = stages.at(-1)?.key
    if (
      stage === last &&
      !confirm(`"${deal.name}" 을(를) ${stages.at(-1)?.label}(으)로 옮기면 성사로 끝납니다.`)
    )
      return
    move.mutate(
      { id: deal.id, version: deal.version, stage },
      {
        onSuccess: () => {
          toast.success(stage === last ? '성사로 끝냈습니다.' : '단계를 옮겼습니다.')
          if (fromKeyboard) refocus(deal.id, stage)
        },
        onError: (err) =>
          toast.error(err instanceof ApiError ? err.message : '단계를 옮기지 못했습니다.'),
      },
    )
  }

  const onDrop = (event: DragEvent, stage: string) => {
    event.preventDefault()
    setOver(null)
    const deal = items.find((d) => d.id === event.dataTransfer.getData(DRAG_TYPE))
    if (deal) moveTo(deal, stage)
  }

  if (deals.isPending) return <SkeletonRows rows={4} />
  if (!deals.data) {
    return <p className="text-danger py-8 text-center text-sm">안건을 불러오지 못했습니다.</p>
  }

  return (
    // 좁으면 단계마다 한 덩어리씩 세로로 쌓고, 넓으면 칸반처럼 열을 가로로 늘어놓는다.
    // 기준은 화면 폭이 아니라 이 보드의 폭이다(@container). 사이드바가 270px 을 먹어서, 화면
    // 폭으로 가르면 1024px 화면에서 다섯 열이 130px 씩으로 눌려 제목과 금액이 겹치고 카드
    // 글자가 밖으로 나간다. 896px(@4xl)이면 열 하나가 170px 쯤이다.
    <div className="@container">
      <div className="grid gap-3 @4xl:grid-cols-5">
        {stages.map((stage) => {
          const inStage = items.filter((d) => d.stage === stage.key)
          const total = inStage.reduce((sum, d) => sum + (d.amount_krw ?? 0), 0)
          return (
            <section
              key={stage.key}
              aria-label={`${stage.label} 단계`}
              data-stage-column={stage.key}
              tabIndex={-1}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
                e.preventDefault()
                setOver(stage.key)
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null)
              }}
              onDrop={(e) => onDrop(e, stage.key)}
              className={cn(
                'bg-sunken min-h-24 rounded-xl p-2 transition-colors outline-none',
                over === stage.key && 'bg-accent-soft',
              )}
            >
              <header className="flex items-baseline justify-between px-1.5 pt-1 pb-2">
                <h3 className="text-fg text-sm font-semibold">
                  {stage.label}
                  <span className="text-subtle ml-1.5 font-normal">{inStage.length}</span>
                </h3>
                {total > 0 && (
                  <span className="text-muted text-xs tabular-nums">{formatEok(total)}</span>
                )}
              </header>
              <ul className="space-y-2">
                {inStage.map((deal) => (
                  <DealCard key={deal.id} deal={deal} busy={move.isPending} onMove={moveTo} />
                ))}
              </ul>
            </section>
          )
        })}
      </div>
    </div>
  )
}

function DealCard({
  deal,
  busy,
  onMove,
}: {
  deal: Deal
  busy: boolean
  onMove: (deal: Deal, stage: string, fromKeyboard?: boolean) => void
}) {
  return (
    <li
      draggable={CAN_DRAG}
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_TYPE, deal.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      className={cn(
        'border-line bg-surface space-y-1.5 rounded-lg border p-3',
        CAN_DRAG && 'cursor-grab active:cursor-grabbing',
      )}
    >
      <Link
        to={`/crm/deals/${deal.id}`}
        className="text-fg hover:text-accent block text-sm font-medium hover:underline"
      >
        {deal.name}
      </Link>
      <p className="text-muted text-xs">
        {deal.org.name}
        {deal.amount_krw !== null && (
          <span className="text-fg ml-1.5 tabular-nums">{formatEok(deal.amount_krw)}</span>
        )}
      </p>
      {deal.owner && <p className="text-subtle text-xs">담당 {deal.owner.name}</p>}
      <NextAction deal={deal} />
      {!CAN_DRAG && (
        <Select
          aria-label={`${deal.name} 단계`}
          data-deal-stage={deal.id}
          className="h-8 text-xs"
          value={deal.stage}
          disabled={busy}
          options={DEAL_STAGES[deal.kind].map((s) => ({ value: s.key, label: s.label }))}
          onChange={(e) => onMove(deal, e.target.value, true)}
        />
      )}
    </li>
  )
}
