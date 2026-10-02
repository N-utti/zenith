import { useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Spinner } from '@/components/ui/Spinner'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/Table'
import { useToast } from '@/components/ui/ToastContext'
import { ApiError } from '@/lib/api'
import { formatDateTime, formatRelative } from '@/lib/datetime'
import { useImportContacts, useLastImport, useUndoImport } from './api'
import {
  IMPORT_MAX_ROWS,
  ORG_TYPE_LABEL,
  ORG_TYPES,
  type ImportResult,
  type ImportRow,
} from './types'

const STATUS: Record<
  ImportRow['status'],
  { label: string; tone: 'success' | 'subtle' | 'danger' }
> = {
  ok: { label: '등록', tone: 'success' },
  skip: { label: '건너뜀', tone: 'subtle' },
  error: { label: '오류', tone: 'danger' },
}

const errorText = (err: unknown) =>
  err instanceof ApiError ? err.message : '파일을 읽지 못했습니다.'

/**
 * CSV 로 기관·담당자를 한 번에 등록한다(15 FR-CRM-05). 파일을 고르면 서버가 판정만 한 미리보기를
 * 먼저 보여 주고, 확인을 눌러야 반영한다. 휴대폰 폭에서는 숨긴다(내보내기와 같은 이유).
 */
export function ImportButton() {
  const toast = useToast()
  const importing = useImportContacts()
  const input = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<ImportResult | null>(null)
  const last = useLastImport(open)
  const undo = useUndoImport()

  // 반영 중에는 닫지 못하게 한다. 닫으면 서버에는 들어가는데 결과 알림이 사라진다.
  const applying = importing.isPending && preview !== null
  const close = () => {
    if (applying) return
    setOpen(false)
    setFile(null)
    setPreview(null)
    importing.reset()
  }

  const choose = (picked: File | undefined) => {
    if (!picked) return
    setFile(picked)
    setPreview(null)
    importing.mutate(
      { file: picked, dryRun: true },
      { onSuccess: setPreview, onError: (err) => toast.error(errorText(err)) },
    )
  }

  const apply = () => {
    if (!file) return
    importing.mutate(
      { file, dryRun: false },
      {
        onSuccess: (done) => {
          const failed = done.rows.filter((r) => r.status === 'error').length
          toast.success(
            `기관 ${done.new_orgs}곳·담당자 ${done.new_contacts}명을 등록했습니다.` +
              (failed ? ` 오류 ${failed}행은 빠졌습니다.` : ''),
          )
          close()
        },
        onError: (err) => toast.error(errorText(err)),
      },
    )
  }

  const undoLast = () => {
    const target = last.data?.import
    if (!target) return
    // 언제 것인지를 같이 적는다. 방금 올린 것인 줄 알고 어제 것을 되돌리지 않게.
    if (
      !confirm(
        `마지막 가져오기(${formatRelative(target.created_at)})로 만든 기관 ${target.new_orgs}곳·담당자 ${target.new_contacts}명을 지웁니다. 가져온 뒤 손으로 고친 내용도 같이 사라집니다. 그사이 쓰이기 시작한 것(안건·활동 기록이 생긴 기관과 그 담당자)은 남깁니다.`,
      )
    )
      return
    undo.mutate(target.id, {
      onSuccess: (done) => {
        const kept = done.kept_orgs + done.kept_contacts
        toast.success(
          `기관 ${done.removed_orgs}곳·담당자 ${done.removed_contacts}명을 되돌렸습니다.` +
            (kept ? ` 그사이 쓰이기 시작한 ${kept}건은 남겼습니다.` : ''),
        )
      },
      onError: (err) => toast.error(err instanceof ApiError ? err.message : '되돌리지 못했습니다.'),
    })
  }

  const count = (status: ImportRow['status']) =>
    preview?.rows.filter((r) => r.status === status).length ?? 0
  const creates = preview ? preview.new_orgs + preview.new_contacts : 0

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        className="hidden sm:inline-flex"
        title="CSV 파일로 기관·담당자를 한 번에 등록합니다."
        onClick={() => setOpen(true)}
      >
        <Upload className="size-4" />
        가져오기
      </Button>

      <Modal
        open={open}
        onClose={close}
        size="lg"
        title="CSV 가져오기"
        description={
          preview
            ? `${file?.name}: 새 기관 ${preview.new_orgs}곳, 담당자 ${preview.new_contacts}명`
            : '한 줄에 담당자 한 명. 이름 칸이 비면 기관만 등록합니다.'
        }
        footer={
          <>
            <Button variant="secondary" disabled={applying} onClick={close}>
              취소
            </Button>
            {preview && (
              <Button disabled={importing.isPending || creates === 0} onClick={apply}>
                {importing.isPending && <Spinner />}
                {creates === 0 ? '등록할 것이 없습니다' : '반영'}
              </Button>
            )}
          </>
        }
      >
        <input
          ref={input}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            choose(e.target.files?.[0])
            // 같은 파일을 고쳐서 다시 고를 수 있게 비운다.
            e.target.value = ''
          }}
        />

        {!preview ? (
          <div className="text-muted space-y-3 text-sm">
            <p>
              첫 줄은 칸 이름입니다. <b className="text-fg">기관</b> 칸은 꼭 있어야 하고, 나머지는
              있는 것만 씁니다: 유형 · 이름 · 부서·직함 · 전화 · 이메일 · 메모. 내보내기 파일을
              고쳐서 그대로 올려도 됩니다.
            </p>
            <p>
              유형은 {ORG_TYPES.map((t) => ORG_TYPE_LABEL[t]).join(' · ')} 중 하나이고, 비우면
              기타입니다. 이름이 같은 기관(띄어쓰기·(주) 표기 무시)이 이미 있으면 그 기관에 붙이고,
              같은 기관에 같은 이름의 담당자가 있으면 건너뜁니다.
            </p>
            <p>
              엑셀에서 「CSV」 로 저장하면 됩니다. 한 번에 {IMPORT_MAX_ROWS.toLocaleString()}행까지.
            </p>
            <Button
              disabled={importing.isPending || undo.isPending}
              onClick={() => input.current?.click()}
            >
              {importing.isPending ? <Spinner /> : <Upload className="size-4" />}
              파일 고르기
            </Button>
            {/* 잘못된 파일을 올렸을 때의 길. 내가 한 마지막 가져오기만, 가져온 지 하루 안에만 보인다. */}
            {last.data?.import && (
              <div className="border-line bg-sunken flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2">
                <span>
                  마지막 가져오기:{' '}
                  <time
                    dateTime={last.data.import.created_at}
                    title={formatDateTime(last.data.import.created_at)}
                  >
                    {formatRelative(last.data.import.created_at)}
                  </time>{' '}
                  · 기관 {last.data.import.new_orgs}곳, 담당자 {last.data.import.new_contacts}명
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto"
                  disabled={undo.isPending || importing.isPending}
                  onClick={undoLast}
                >
                  {undo.isPending && <Spinner />}
                  되돌리기
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge tone="success">등록 {count('ok')}행</Badge>
              {count('skip') > 0 && <Badge tone="subtle">건너뜀 {count('skip')}행</Badge>}
              {count('error') > 0 && <Badge tone="danger">오류 {count('error')}행</Badge>}
              {count('error') > 0 && (
                <span className="text-muted">오류 행은 빼고 반영합니다. 고쳐서 다시 올리세요.</span>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto"
                disabled={importing.isPending}
                onClick={() => input.current?.click()}
              >
                다른 파일
              </Button>
            </div>
            <div className="max-h-[50vh] overflow-y-auto">
              <Table label="가져오기 미리보기">
                <THead>
                  <tr>
                    <TH>줄</TH>
                    <TH>기관</TH>
                    <TH>담당자</TH>
                    <TH>결과</TH>
                  </tr>
                </THead>
                <TBody>
                  {preview.rows.map((row) => (
                    <TR key={row.line}>
                      <TD className="text-muted tabular-nums">{row.line}</TD>
                      <TD>{row.org_name || '(비어 있음)'}</TD>
                      <TD>{row.contact_name}</TD>
                      <TD>
                        <span className="flex flex-wrap items-center gap-1.5">
                          <Badge tone={STATUS[row.status].tone}>{STATUS[row.status].label}</Badge>
                          {row.note && <span className="text-muted text-xs">{row.note}</span>}
                        </span>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}
