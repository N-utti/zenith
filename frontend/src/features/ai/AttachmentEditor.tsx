import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Download, Loader2, Wand2 } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Table, TBody, TD, TH, THead, TR, TableEmpty } from '@/components/ui/Table'
import { Textarea } from '@/components/ui/Textarea'
import { useToast } from '@/components/ui/ToastContext'
import { ApiError } from '@/lib/api'
import { downloadFromApi } from '@/lib/download'
import { editAiAttachment } from './api'
import { isFormula } from './attachEdit'
import type { AiAttachment } from './types'

/**
 * 첨부 칩의 「AI로 고치기」(백엔드 #401). 지시를 받아 고친 새 첨부를 만들고, 바뀐 곳을 표로 보인 뒤에야
 * 내려받게 한다. 자동으로 내려받지 않는다. 파일 안에 숨은 지시가 결과를 비틀 수 있어 사람이 먼저 본다.
 */
export function AttachmentEditor({ file, onClose }: { file: AiAttachment; onClose: () => void }) {
  const toast = useToast()
  const [instruction, setInstruction] = useState('')
  const edit = useMutation({ mutationFn: (text: string) => editAiAttachment(file.id, text) })
  const done = edit.data
  const xlsx = file.name.toLowerCase().endsWith('.xlsx')
  // 기다리는 동안은 닫지 않는다. 닫아도 서버는 새 파일을 만들어 보관 한도를 쓰는데, 받을 자리가 없다.
  const close = edit.isPending ? () => {} : onClose

  const submit = () => {
    const text = instruction.trim()
    if (text && !edit.isPending) edit.mutate(text)
  }
  const download = () => {
    if (!done) return
    downloadFromApi(`/api/ai/attachments/${done.result.id}`, done.result.name).catch(() =>
      toast.error('내려받지 못했습니다.'),
    )
  }

  if (done) {
    return (
      // 키를 달아 새 창으로 연다. 같은 창의 내용만 바뀌면 초점 가두기가 다시 안 돌아 초점이 창 밖으로 빠진다.
      <Modal
        key="result"
        open
        onClose={onClose}
        size="lg"
        title="AI가 고친 내용"
        description={`내려받기 전에 바뀐 곳을 확인하세요. 원본은 그대로 남고 「${done.result.name}」 파일이 새로 생겼습니다.`}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => edit.reset()}>
              다시 고치기
            </Button>
            <Button size="sm" onClick={download}>
              <Download className="size-4" />
              내려받기
            </Button>
          </>
        }
      >
        <Table label="변경 내역">
          <THead>
            <TR>
              <TH className="w-28">위치</TH>
              <TH>바꾸기 전</TH>
              <TH>바꾼 뒤</TH>
            </TR>
          </THead>
          <TBody>
            {done.changes.length === 0 && <TableEmpty colSpan={3}>바뀐 곳이 없습니다.</TableEmpty>}
            {done.changes.map((change, i) => (
              <TR key={i}>
                <TD className="text-muted [overflow-wrap:anywhere]">{change.where}</TD>
                <TD className="text-muted whitespace-pre-wrap [overflow-wrap:anywhere]">
                  <Cell value={change.before} />
                </TD>
                <TD className="whitespace-pre-wrap [overflow-wrap:anywhere]">
                  {isFormula(file.name, change.after) ? (
                    <span className="flex items-start gap-1.5">
                      <Badge tone="warning" className="shrink-0">
                        수식
                      </Badge>
                      <code className="min-w-0 font-mono text-xs">{change.after}</code>
                    </span>
                  ) : (
                    <Cell value={change.after} />
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {done.changes.some((change) => isFormula(file.name, change.after)) && (
          <p className="text-subtle mt-2 text-xs">수식의 결과는 Excel에서 열 때 다시 계산됩니다.</p>
        )}
      </Modal>
    )
  }

  return (
    <Modal
      key="form"
      open
      onClose={close}
      title="AI로 고치기"
      description={`「${file.name}」 파일을 지시대로 고쳐 새 파일로 만듭니다. 원본은 그대로 남습니다.`}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={edit.isPending}>
            취소
          </Button>
          <Button size="sm" onClick={submit} disabled={edit.isPending || !instruction.trim()}>
            {edit.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Wand2 className="size-4" />
            )}
            {edit.isPending ? '고치는 중' : '고치기'}
          </Button>
        </>
      }
    >
      <Textarea
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        // 기다리는 동안 고치면 결과가 화면에 남은 지시와 달라진다. disabled 는 초점을 창 밖(body)으로 빼서 읽기 전용으로 막는다.
        readOnly={edit.isPending}
        submitOnEnter
        onSubmitEnter={submit}
        rows={3}
        // 서버 상한(EditIn.instruction). 넘기면 422 인데 그 사유는 배열이라 화면에 일반 실패만 뜬다.
        maxLength={2000}
        autoFocus
        aria-label="고칠 내용"
        placeholder={
          xlsx ? '예: 3월 매출 열을 합계 수식으로 바꿔 줘' : '예: 2장의 날짜를 10월 20일로 고쳐 줘'
        }
      />
      <p className="text-subtle mt-2 text-xs">
        {xlsx
          ? '칸 단위로 고칩니다. 차트·그림이 있는 엑셀은 고칠 수 없습니다.'
          : '문단 단위로 고칩니다. 링크·그림이 있는 문단은 고치지 못합니다.'}
      </p>
      {edit.isPending && (
        <p role="status" className="text-subtle mt-2 text-xs">
          고치는 중입니다. 파일에 따라 2분까지 걸릴 수 있습니다.
        </p>
      )}
      {edit.isError && (
        <p role="alert" className="text-danger mt-2 text-sm">
          {edit.error instanceof ApiError && edit.error.message
            ? edit.error.message
            : '고치지 못했습니다. 다시 시도해 주세요.'}
        </p>
      )}
    </Modal>
  )
}

/** 서버는 지운 칸과 원래 빈 칸을 모두 빈 글자로 준다. 아무것도 안 보이면 표가 깨진 것처럼 보인다. */
function Cell({ value }: { value: string }) {
  return value ? <>{value}</> : <span className="text-subtle">(빈 칸)</span>
}
