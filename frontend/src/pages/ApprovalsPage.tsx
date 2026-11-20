import { useCallback, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router'
import { ArrowUpRight, ExternalLink, Link2, Plus, Trash2 } from 'lucide-react'
import { askConfirm } from '@/components/ui/confirm'
import { openTab } from '@/components/layout/desktopTabs'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ContextMenu, ContextMenuItem } from '@/components/ui/ContextMenu'
import { PageHeader } from '@/components/ui/PageHeader'
import { Select } from '@/components/ui/Select'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { Table, TableEmpty, TBody, TD, TH, THead, TR } from '@/components/ui/Table'
import { Tabs } from '@/components/ui/Tabs'
import { useToast } from '@/components/ui/ToastContext'
import { useApprovals, useDeleteApproval, useDeleteDraft } from '@/features/approvals/api'
import {
  APPROVAL_TYPE_LABEL,
  BOX_LABEL,
  statusLabel,
  statusTone,
  type ApprovalBox,
  type ApprovalListItem,
  type DocumentStatus,
} from '@/features/approvals/types'
import { useCurrentUser } from '@/features/auth/AuthContext'
import { cn } from '@/lib/cn'
import { copyText } from '@/lib/clipboard'
import { formatDateTime, formatRelative } from '@/lib/datetime'
import { deferDelete } from '@/lib/deferDelete'
import { isDesktopShell } from '@/lib/desktop'
import { serverOrigin } from '@/lib/serverOrigin'
import { useLongPress } from '@/lib/useLongPress'

const BOXES: ApprovalBox[] = ['inbox', 'sent', 'reference', 'draft']
/**
 * 임원에게는 끝난 문서를 전부 모아 보는 탭이 하나 더 있다. 남의 문서까지 보는 관리용이라 `관리` 묶음으로 떼어 보인다.
 * 숨김은 편의이고 차단은 서버 403.
 */
const EXEC_BOXES: ApprovalBox[] = [...BOXES, 'done']

const TYPE_OPTIONS = [
  { value: '', label: '모든 유형' },
  ...Object.entries(APPROVAL_TYPE_LABEL).map(([value, label]) => ({ value, label })),
]

/**
 * 탭마다 들어올 수 있는 상태가 다르다. 받은 결재는 늘 결재 대기, 임시저장은 늘 임시저장이라
 * 고를 것이 없어 칸을 숨긴다. 전체 문서는 서버가 승인·반려·강제 종결만 담는다.
 */
const BOX_STATUSES: Partial<Record<ApprovalBox, DocumentStatus[]>> = {
  sent: ['pending', 'approved', 'rejected', 'canceled', 'closed'],
  reference: ['pending', 'approved', 'rejected', 'canceled', 'closed'],
  done: ['approved', 'rejected', 'closed'],
}

/** 결재함(13 SCR-APV-02). 받은 결재 · 보낸 결재 · 참조 · 임시저장. */
export function ApprovalsPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const { search } = useLocation()
  const isExec = useCurrentUser().role === 'exec'
  const boxes = isExec ? EXEC_BOXES : BOXES
  const requested = params.get('box') as ApprovalBox | null
  const box: ApprovalBox = requested && boxes.includes(requested) ? requested : 'inbox'
  // 받은 결재와 전체 문서는 남이 올린 문서라 누가 올렸는지를 보인다. 나머지는 지금 누구 차례인지.
  const showDrafter = box === 'inbox' || box === 'done'
  // 고른 값은 주소에 둔다. 문서를 열었다 뒤로 와도 그대로 남는다.
  // 손으로 고친 주소의 엉뚱한 값은 고르지 않은 것으로 본다. 그대로 보내면 서버가 422 로 거절해 목록이 통째로 안 뜬다.
  const requestedType = params.get('type') ?? ''
  const type = Object.hasOwn(APPROVAL_TYPE_LABEL, requestedType) ? requestedType : ''
  const statuses = BOX_STATUSES[box] ?? []
  const requestedStatus = params.get('status') as DocumentStatus | null
  const status = requestedStatus && statuses.includes(requestedStatus) ? requestedStatus : ''
  const setFilter = (key: 'type' | 'status', value: string) =>
    setParams(
      (prev) => {
        if (value) prev.set(key, value)
        else prev.delete(key)
        return prev
      },
      { replace: true },
    )
  const filtered = type !== '' || status !== ''
  const inbox = useApprovals('inbox')
  const list = useApprovals(box, { type, status })
  const items = list.data?.items ?? []
  const removeDraft = useDeleteDraft()
  const removeDone = useDeleteApproval()
  const toast = useToast()
  // 삭제 칸은 임시저장 탭에만 붙는다. 끝난 문서 삭제는 임원 전용이라 칸 대신 우클릭 메뉴와 상세 화면에 둔다.
  const deletable = box === 'draft'
  const columns = deletable ? 6 : 5
  // 임시저장은 읽을 것이 아니라 이어 쓸 것이다. 상세를 거치지 않고 바로 작성 화면을 연다.
  // 문서 주소에는 지금 탭·필터를 그대로 달아 보낸다. 상세 화면의 「결재함」 링크가 그 값으로 돌아온다.
  // 주소에 두는 것은 데스크톱 탭이 주소만 기억해서다. 새 탭에서 열거나 탭을 오갔다 와도 남는다.
  const hrefOf = (id: string) =>
    box === 'draft' ? `/approvals/new?draft=${id}` : `/approvals/${id}${search}`

  // 임원은 끝난 일반 결재를 지울 수 있다(상세 화면과 같은 조건, 백엔드 README 78). 근태 신청 문서는
  // 근태 기록이 가리켜 서버가 409 로 막는다. 탭과 상관없이 문서의 상태로 가른다.
  const canDeleteDone = (item: ApprovalListItem) =>
    isExec &&
    item.type_code === 'general' &&
    ['approved', 'rejected', 'closed'].includes(item.status)
  const deleteDone = async (item: ApprovalListItem) => {
    const ok = await askConfirm({
      title: '이 문서를 삭제할까요?',
      description: '결재선과 첨부도 같이 삭제되고 되돌릴 수 없습니다.',
      confirmLabel: '삭제',
      danger: true,
    })
    if (!ok) return
    // 서버에 복원하는 길이 없어 실행 취소 시간 뒤에 보낸다(`deferDelete`). 목록에서는 바로 빠지고,
    // 토스트의 실행 취소를 누르면 다시 나타난다. 임시저장 삭제도 같다.
    deferDelete(toast, {
      ids: [item.id],
      message: '문서를 삭제했습니다.',
      commit: () => removeDone.mutateAsync(item.id),
      failMessage: '문서를 삭제하지 못했습니다.',
    })
  }

  const deleteDraft = async (item: ApprovalListItem) => {
    const ok = await askConfirm({
      title: '이 임시저장을 삭제할까요?',
      description: '되돌릴 수 없습니다.',
      confirmLabel: '삭제',
      danger: true,
    })
    if (!ok) return
    deferDelete(toast, {
      ids: [item.id],
      message: '임시저장을 삭제했습니다.',
      commit: () => removeDraft.mutateAsync(item.id),
      failMessage: '임시저장을 삭제하지 못했습니다.',
    })
  }

  // 행 우클릭 메뉴. 마우스는 우클릭, 키보드는 Shift+F10·메뉴 키(초점이 제목 링크에 있다), 손가락 기기는 꾹 누르기.
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])
  const openMenuAt = (target: Element, x: number, y: number) => {
    const row = target.closest<HTMLElement>('tr[data-id]')
    const item = items.find((i) => i.id === row?.dataset.id)
    if (!row || !item) return false
    // 키보드로 열면 포인터 좌표가 없다. 그 행 바로 아래에 띄운다.
    const rect = row.getBoundingClientRect()
    setMenu({ id: item.id, x: x || rect.left, y: y || rect.bottom })
    return true
  }
  const longPress = useLongPress(openMenuAt)
  // 그릴 때마다 지금 목록에서 다시 찾는다. 탭이 바뀌거나(뒤로 가기) 목록에서 빠진 문서의 메뉴는 저절로 사라진다.
  const menuItem = menu ? items.find((i) => i.id === menu.id) : undefined
  // 상태도 비운다. 남겨 두면 그 문서가 다시 보일 때(앞으로 가기) 메뉴가 되살아난다. 문서 트리와 같은 처리.
  if (menu && !menuItem && list.data) setMenu(null)

  return (
    <>
      <PageHeader
        title="결재"
        actions={
          <Button size="sm" onClick={() => void navigate('/approvals/new')}>
            <Plus className="size-4" />새 기안
          </Button>
        }
      />
      <Tabs
        items={boxes.map((key) => ({
          key,
          label: BOX_LABEL[key],
          count: key === 'inbox' ? (inbox.data?.items.length ?? 0) : undefined,
          group: key === 'done' ? '관리' : undefined,
        }))}
        value={box}
        onChange={(key) =>
          setParams(
            (prev) => {
              if (key === 'inbox') prev.delete('box')
              else prev.set('box', key)
              // 탭을 바꾸면 거르기를 비운다. 남겨 두면 탭 옆 숫자(거르지 않은 수)와 목록이 어긋난다.
              prev.delete('type')
              prev.delete('status')
              return prev
            },
            { replace: true },
          )
        }
      >
        {() => (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <div className="w-36">
                <Select
                  aria-label="유형"
                  options={TYPE_OPTIONS}
                  value={type}
                  onChange={(e) => setFilter('type', e.target.value)}
                />
              </div>
              {statuses.length > 0 && (
                <div className="w-36">
                  <Select
                    aria-label="상태"
                    options={[
                      { value: '', label: '모든 상태' },
                      ...statuses.map((value) => ({ value, label: statusLabel(value) })),
                    ]}
                    value={status}
                    onChange={(e) => setFilter('status', e.target.value)}
                  />
                </div>
              )}
            </div>
            {list.isPending ? (
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
                    <TH>{showDrafter ? '기안자' : '처리 중'}</TH>
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
                      {filtered
                        ? '조건에 맞는 문서가 없습니다.'
                        : box === 'inbox'
                          ? '처리할 결재가 없습니다.'
                          : box === 'done'
                            ? '끝난 문서가 없습니다.'
                            : '문서가 없습니다.'}
                    </TableEmpty>
                  )}
                  {items.map((item) => {
                    const at = item.submitted_at ?? item.created_at
                    return (
                      // 행 어디를 눌러도 열린다. 제목 링크의 ::after 를 행 전체로 펼친다(relative 는 행에).
                      // 링크 하나 그대로라 키보드·가운데 클릭·새 탭 열기가 살아 있다.
                      <TR
                        key={item.id}
                        data-id={item.id}
                        data-long-press
                        {...longPress}
                        onContextMenu={(e) => {
                          if (
                            e.target instanceof Element &&
                            openMenuAt(e.target, e.clientX, e.clientY)
                          )
                            e.preventDefault()
                        }}
                        className={cn(
                          'relative',
                          // 꾹 누를 때 아이폰의 링크 미리보기·글자 선택이 메뉴보다 먼저 뜨지 않게 한다.
                          'pointer-coarse:select-none pointer-coarse:[-webkit-touch-callout:none]',
                          // 어느 행의 메뉴인지 보이게 메뉴가 떠 있는 동안 행을 칠해 둔다.
                          menu?.id === item.id && 'bg-surface-hover',
                        )}
                      >
                        <TD className="whitespace-nowrap">{APPROVAL_TYPE_LABEL[item.type_code]}</TD>
                        <TD>
                          <Link
                            to={hrefOf(item.id)}
                            className="text-fg font-medium after:absolute after:inset-0"
                          >
                            {item.title}
                          </Link>
                        </TD>
                        <TD className="text-muted whitespace-nowrap">
                          {showDrafter ? item.drafter.name : (item.waiting_on?.name ?? '-')}
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
                              aria-label={`${item.title} 임시저장 삭제`}
                              title="임시저장 삭제"
                              disabled={removeDraft.isPending}
                              onClick={() => deleteDraft(item)}
                              className="text-subtle hover:text-danger relative z-10 grid size-7 cursor-pointer place-items-center rounded disabled:cursor-default disabled:opacity-55"
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
            )}
          </>
        )}
      </Tabs>
      {menu && menuItem && (
        <ContextMenu at={menu} label={`${menuItem.title} 메뉴`} onClose={closeMenu}>
          <ContextMenuItem
            icon={ArrowUpRight}
            label="열기"
            onSelect={() => void navigate(hrefOf(menuItem.id))}
          />
          <ContextMenuItem
            icon={ExternalLink}
            label="새 탭에서 열기"
            onSelect={() =>
              isDesktopShell()
                ? openTab(hrefOf(menuItem.id))
                : void window.open(hrefOf(menuItem.id), '_blank', 'noopener')
            }
          />
          {/* 임시저장은 기안자만 연다. 남에게 보낼 링크가 아니다. */}
          {box !== 'draft' && (
            <ContextMenuItem
              icon={Link2}
              label="링크 복사"
              onSelect={() =>
                void copyText(`${serverOrigin() || location.origin}/approvals/${menuItem.id}`).then(
                  () => toast.success('결재 문서 링크를 복사했습니다.'),
                  () => toast.error('링크를 복사하지 못했습니다.'),
                )
              }
            />
          )}
          {(deletable || canDeleteDone(menuItem)) && (
            <ContextMenuItem
              icon={Trash2}
              label="삭제"
              danger
              disabledReason={
                removeDraft.isPending || removeDone.isPending ? '삭제하는 중' : undefined
              }
              onSelect={() => (deletable ? deleteDraft(menuItem) : deleteDone(menuItem))}
            />
          )}
        </ContextMenu>
      )}
    </>
  )
}
