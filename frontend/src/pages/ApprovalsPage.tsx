import { Link, useNavigate, useSearchParams } from 'react-router'
import { Plus, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/PageHeader'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { Table, TableEmpty, TBody, TD, TH, THead, TR } from '@/components/ui/Table'
import { Tabs } from '@/components/ui/Tabs'
import { useToast } from '@/components/ui/ToastContext'
import { useApprovals, useDeleteDraft } from '@/features/approvals/api'
import {
  APPROVAL_TYPE_LABEL,
  BOX_LABEL,
  statusLabel,
  statusTone,
  type ApprovalBox,
} from '@/features/approvals/types'
import { ApiError } from '@/lib/api'
import { formatDateTime, formatRelative } from '@/lib/datetime'

const BOXES: ApprovalBox[] = ['inbox', 'sent', 'reference', 'draft']

/** 결재함(13 SCR-APV-02). 받은 결재 · 보낸 결재 · 참조 · 임시저장. */
export function ApprovalsPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const requested = params.get('box') as ApprovalBox | null
  const box: ApprovalBox = requested && BOXES.includes(requested) ? requested : 'inbox'
  const inbox = useApprovals('inbox')
  const list = useApprovals(box)
  const items = list.data?.items ?? []
  const removeDraft = useDeleteDraft()
  const toast = useToast()
  // 임시저장 탭에만 지우기 칸이 붙는다. 다른 탭의 문서는 이력이라 지우지 않는다.
  const deletable = box === 'draft'
  const columns = deletable ? 6 : 5

  return (
    <>
      <PageHeader
        title="결재"
        description="근태 신청도 여기서 결재됩니다. 문서는 기안자 · 결재선에 오른 사람 · 임원만 봅니다."
        actions={
          <Button size="sm" onClick={() => void navigate('/approvals/new')}>
            <Plus className="size-4" />새 기안
          </Button>
        }
      />
      <Tabs
        items={BOXES.map((key) => ({
          key,
          label: BOX_LABEL[key],
          count: key === 'inbox' ? (inbox.data?.items.length ?? 0) : undefined,
        }))}
        value={box}
        onChange={(key) =>
          setParams(
            (prev) => {
              if (key === 'inbox') prev.delete('box')
              else prev.set('box', key)
              return prev
            },
            { replace: true },
          )
        }
      >
        {() =>
          list.isPending ? (
            <SkeletonRows rows={5} />
          ) : (
            <Table
              label={`${BOX_LABEL[box]} 목록`}
              // 제목이 길다. 열이 짜부라지면 "9월 워크숍 장소 대관 지출" 이 375px 에서 한 글자씩
              // 세로로 쏟아진다. 한 줄로 세운다.
              wide
            >
              <THead>
                <tr>
                  <TH>유형</TH>
                  <TH>제목</TH>
                  <TH>{box === 'inbox' ? '기안자' : '처리 중'}</TH>
                  <TH>상태</TH>
                  <TH>{box === 'draft' ? '작성' : '상신'}</TH>
                  {deletable && <TH className="w-12 text-right">작업</TH>}
                </tr>
              </THead>
              <TBody>
                {list.isError && (
                  <TableEmpty colSpan={columns}>결재함을 불러오지 못했습니다.</TableEmpty>
                )}
                {list.data && items.length === 0 && (
                  <TableEmpty colSpan={columns}>
                    {box === 'inbox' ? '처리할 결재가 없습니다.' : '문서가 없습니다.'}
                  </TableEmpty>
                )}
                {items.map((item) => {
                  const at = item.submitted_at ?? item.created_at
                  return (
                    <TR key={item.id}>
                      <TD className="whitespace-nowrap">{APPROVAL_TYPE_LABEL[item.type_code]}</TD>
                      <TD>
                        {/* 임시저장은 읽을 것이 아니라 이어 쓸 것이다. 상세를 거치지 않고 바로 작성 화면을 연다. */}
                        <Link
                          to={
                            box === 'draft'
                              ? `/approvals/new?draft=${item.id}`
                              : `/approvals/${item.id}`
                          }
                          className="text-fg hover:text-accent font-medium hover:underline"
                        >
                          {item.title}
                        </Link>
                      </TD>
                      <TD className="text-muted whitespace-nowrap">
                        {box === 'inbox' ? item.drafter.name : (item.waiting_on?.name ?? '-')}
                      </TD>
                      <TD>
                        <Badge tone={statusTone(item.status)}>{statusLabel(item.status)}</Badge>
                      </TD>
                      <TD className="text-muted whitespace-nowrap">
                        <time dateTime={at} title={formatDateTime(at)}>
                          {formatRelative(at)}
                        </time>
                      </TD>
                      {deletable && (
                        <TD className="text-right">
                          <button
                            type="button"
                            aria-label={`${item.title} 임시저장 지우기`}
                            title="임시저장 지우기"
                            disabled={removeDraft.isPending}
                            onClick={() => {
                              if (!confirm('이 임시저장을 지울까요? 되돌릴 수 없습니다.')) return
                              removeDraft.mutate(item.id, {
                                onSuccess: () => toast.success('임시저장을 지웠습니다.'),
                                onError: (err) =>
                                  toast.error(
                                    err instanceof ApiError
                                      ? err.message
                                      : '임시저장을 지우지 못했습니다.',
                                  ),
                              })
                            }}
                            className="text-subtle hover:text-danger grid size-7 cursor-pointer place-items-center rounded disabled:cursor-default disabled:opacity-55"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </TD>
                      )}
                    </TR>
                  )
                })}
              </TBody>
            </Table>
          )
        }
      </Tabs>
    </>
  )
}
