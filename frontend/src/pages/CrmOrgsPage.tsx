import { useDeferredValue, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Plus, Search } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { PageHeader } from '@/components/ui/PageHeader'
import { Select } from '@/components/ui/Select'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { Table, TableEmpty, TBody, TD, TH, THead, TR } from '@/components/ui/Table'
import { useToast } from '@/components/ui/ToastContext'
import { useCurrentUser } from '@/features/auth/AuthContext'
import {
  CRM_EXTRAS_ENABLED,
  useDeletedOrgs,
  useOrgs,
  useRestoreOrg,
} from '@/features/crm/api'
import { OrgFormModal } from '@/features/crm/CrmForms'
import { ExportButton } from '@/features/crm/ExportButton'
import { ImportButton } from '@/features/crm/ImportButton'
import { ORG_TYPE_LABEL, ORG_TYPES, STALE_DAYS } from '@/features/crm/types'
import { ApiError } from '@/lib/api'
import { formatDateTime, formatRelative } from '@/lib/datetime'

const TYPE_OPTIONS = [
  { value: '', label: '모든 유형' },
  ...ORG_TYPES.map((value) => ({ value, label: ORG_TYPE_LABEL[value] })),
]

const STALE_OPTIONS = [
  { value: '', label: '연락 시기 전체' },
  ...STALE_DAYS.map((days) => ({ value: String(days), label: `${days}일 넘게 연락 없음` })),
]

/**
 * 기관 목록(15 CRM 모듈 설계서 §10). 필터는 주소에 둔다. "90일 넘게 연락 없는 내 기관" 을
 * 그대로 링크로 건넬 수 있어야 한다.
 */
export function CrmOrgsPage() {
  const me = useCurrentUser()
  const [params, setParams] = useSearchParams()
  const [creating, setCreating] = useState(false)
  const [showingDeleted, setShowingDeleted] = useState(false)
  // 검색어는 화면 상태로 들고 주소에는 따라 적기만 한다. 라우터는 주소 변경을 트랜지션으로
  // 늦게 반영해서, 입력칸 값을 주소에서 바로 읽으면 한글 조합 중인 글자가 끊긴다.
  const [q, setQ] = useState(params.get('q') ?? '')
  const stale = Number(params.get('stale'))
  const filter = {
    q: useDeferredValue(q),
    type: params.get('type') ?? '',
    owner: params.get('owner') === 'me' ? me.id : '',
    // 선택지에 없는 값(`?stale=45`)은 셀렉트와 필터가 어긋나므로 버린다.
    staleDays: (STALE_DAYS as readonly number[]).includes(stale) ? stale : 0,
  }
  const orgs = useOrgs(filter)
  const items = orgs.data?.items ?? []
  const filtered = Boolean(filter.q || filter.type || filter.owner || filter.staleDays)

  const setParam = (key: string, value: string) =>
    setParams(
      (prev) => {
        if (value) prev.set(key, value)
        else prev.delete(key)
        return prev
      },
      { replace: true },
    )

  return (
    <>
      <PageHeader
        title="기관"
        description="출자자·공동투자 상대·자문사를 한 주소록에 둡니다. 전 직원이 함께 봅니다."
        actions={
          <>
            <ImportButton />
            <ExportButton entity="orgs" />
            <ExportButton entity="contacts" />
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="size-4" />
              기관 등록
            </Button>
          </>
        }
      />

      <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
        <Input
          icon={<Search className="size-4" />}
          type="search"
          placeholder="기관 이름"
          aria-label="기관 이름 검색"
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setParam('q', e.target.value)
          }}
        />
        <Select
          aria-label="유형"
          value={filter.type}
          options={TYPE_OPTIONS}
          onChange={(e) => setParam('type', e.target.value)}
        />
        <Select
          aria-label="사내 창구"
          value={filter.owner ? 'me' : ''}
          options={[
            { value: '', label: '모든 창구' },
            { value: 'me', label: '내가 맡은 기관' },
          ]}
          onChange={(e) => setParam('owner', e.target.value)}
        />
        <Select
          aria-label="마지막 연락"
          value={filter.staleDays ? String(filter.staleDays) : ''}
          options={STALE_OPTIONS}
          onChange={(e) => setParam('stale', e.target.value)}
        />
      </div>

      {orgs.isPending ? (
        <SkeletonRows rows={5} />
      ) : (
        <Table label="기관 목록" wide>
          <THead>
            <tr>
              <TH>기관</TH>
              <TH>유형</TH>
              <TH>사내 창구</TH>
              <TH>담당자</TH>
              <TH>마지막 연락</TH>
            </tr>
          </THead>
          <TBody>
            {orgs.isError && <TableEmpty colSpan={5}>기관 목록을 불러오지 못했습니다.</TableEmpty>}
            {orgs.data && items.length === 0 && (
              <TableEmpty colSpan={5}>
                {filtered ? '조건에 맞는 기관이 없습니다.' : '등록된 기관이 없습니다.'}
              </TableEmpty>
            )}
            {items.map((org) => (
              <TR key={org.id}>
                <TD>
                  <Link
                    to={`/crm/orgs/${org.id}`}
                    className="text-fg hover:text-accent font-medium hover:underline"
                  >
                    {org.name}
                  </Link>
                </TD>
                <TD>
                  <Badge>{ORG_TYPE_LABEL[org.org_type]}</Badge>
                </TD>
                <TD className="text-muted whitespace-nowrap">
                  {org.owners.map((o) => o.name).join(', ') || '지정 안 됨'}
                </TD>
                <TD className="text-muted tabular-nums">{org.contact_count}명</TD>
                <TD className="text-muted whitespace-nowrap">
                  {org.last_contacted_at ? (
                    <time
                      dateTime={org.last_contacted_at}
                      title={formatDateTime(org.last_contacted_at)}
                    >
                      {formatRelative(org.last_contacted_at)}
                    </time>
                  ) : (
                    '기록 없음'
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      {/* 머리줄에 두면 버튼이 다섯이 되어 한 줄에 안 들어간다. 드물게 쓰는 길이라 표 아래에 둔다.
          화면 편의일 뿐이다. 지운 기관 목록의 실제 차단은 서버 403 이다. */}
      {CRM_EXTRAS_ENABLED && me.role === 'exec' && (
        <div className="mt-3 text-right">
          <button
            type="button"
            className="text-subtle hover:text-fg cursor-pointer text-xs underline"
            onClick={() => setShowingDeleted(true)}
          >
            지운 기관 보기
          </button>
        </div>
      )}

      {creating && <OrgFormModal onClose={() => setCreating(false)} />}
      {showingDeleted && <DeletedOrgsModal onClose={() => setShowingDeleted(false)} />}
    </>
  )
}

/**
 * 지운 기관 목록. 임원만 연다. 기관 삭제는 목록에서만 빼는 것이라(15 §3) 되살리면 담당자·안건·
 * 활동 기록이 그대로 돌아온다. 잘못 지운 기관을 다시 등록해 이력을 잃는 일을 막는다.
 */
function DeletedOrgsModal({ onClose }: { onClose: () => void }) {
  const toast = useToast()
  const deleted = useDeletedOrgs(true)
  const restore = useRestoreOrg()
  const items = deleted.data?.items ?? []

  return (
    <Modal
      open
      onClose={onClose}
      title="지운 기관"
      description="되살리면 담당자·안건·활동 기록이 그대로 돌아옵니다."
      footer={
        <Button variant="secondary" size="sm" onClick={onClose}>
          닫기
        </Button>
      }
    >
      {deleted.isPending && <SkeletonRows rows={2} />}
      {deleted.isError && !deleted.data && (
        <p className="text-muted text-sm">지운 기관을 불러오지 못했습니다.</p>
      )}
      {deleted.data && items.length === 0 && (
        <p className="text-muted text-sm">지운 기관이 없습니다.</p>
      )}
      {items.length > 0 && (
        <ul>
          {items.map((org) => (
            <li
              key={org.id}
              className="border-line flex items-start gap-3 border-b py-3 last:border-b-0"
            >
              <div className="min-w-0 flex-1 text-sm">
                <p className="text-fg flex flex-wrap items-center gap-2 font-medium">
                  {org.name}
                  <Badge>{ORG_TYPE_LABEL[org.org_type]}</Badge>
                </p>
                <p className="text-subtle mt-1 text-xs">
                  <time dateTime={org.deleted_at} title={formatDateTime(org.deleted_at)}>
                    {formatRelative(org.deleted_at)}
                  </time>{' '}
                  지움{org.reason && ` · ${org.reason}`}
                </p>
                {org.duplicate && (
                  <p className="text-muted mt-1 text-xs">
                    같은 이름의 기관이 이미 있습니다:{' '}
                    <Link
                      to={`/crm/orgs/${org.duplicate.id}`}
                      className="hover:text-accent underline"
                    >
                      {org.duplicate.name}
                    </Link>
                  </p>
                )}
              </div>
              <Button
                variant="secondary"
                size="sm"
                className="shrink-0"
                disabled={restore.isPending}
                onClick={() =>
                  restore.mutate(org.id, {
                    onSuccess: () => toast.success(`${org.name}을(를) 되살렸습니다.`),
                    onError: (err) =>
                      toast.error(err instanceof ApiError ? err.message : '되살리지 못했습니다.'),
                  })
                }
              >
                되살리기
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}
