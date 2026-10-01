import { useCallback, useEffect, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { isImage } from '@/features/chat/attachments'
import { ApiError } from '@/lib/api'
import { uploadFile } from './api'
import { PICK_FILE_EVENT } from './FileChip'
import { PICK_IMAGE_EVENT } from './ImageBlock'

/** 서버(목 핸들러)와 같은 상한. 여기서 먼저 걸러야 10MB를 올렸다가 413을 보는 일이 없다. */
const MAX_FILE_BYTES = 10 * 1024 * 1024

/** 파일 선택 창. input을 화면에 두지 않아도 되도록 그때그때 만든다. `accept` 가 비면 모든 파일. */
function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.onchange = () => resolve(input.files?.[0] ?? null)
    input.oncancel = () => resolve(null)
    input.click()
  })
}

/**
 * 사진·파일 첨부. 업로드는 `/api/files` 로 보내고 본문에는 받은 url만 넣는다.
 * 바이너리를 Y.Doc에 담으면 문서가 파일 크기만큼 영구히 불어나고,
 * 버전 스냅샷마다 복사된다.
 *
 * 서버가 그려 주는 네 형식(png·jpeg·gif·webp)은 사진 블록으로, 나머지는 파일 칩으로 넣는다.
 * 채팅과 같은 이유로 이름의 확장자로 가른다(`isImage`).
 */
export function useFileUpload(editor: Editor | null) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const insert = useCallback(
    async (files: File[]) => {
      if (!editor || files.length === 0) return

      const tooBig = files.find((file) => file.size > MAX_FILE_BYTES)
      if (tooBig) {
        setError(`${tooBig.name}: 10MB 이하 파일만 올릴 수 있습니다.`)
        return
      }

      setUploading(true)
      setError(null)
      try {
        // 늘 지금 커서 자리에 넣는다. 넣고 나면 커서가 그 뒤로 가므로 여러 개는 넣은 순서대로 쌓인다.
        for (const file of files) {
          const uploaded = await uploadFile(file)
          const chain = editor.chain().focus()
          if (isImage(file.name)) {
            chain.setImageBlock({ src: uploaded.url, alt: file.name })
          } else {
            chain.setFileChip({ src: uploaded.url, name: uploaded.name, size: uploaded.size })
          }
          chain.run()
        }
      } catch (cause) {
        setError(cause instanceof ApiError ? cause.message : '파일을 올리지 못했습니다.')
      } finally {
        setUploading(false)
      }
    },
    [editor],
  )

  // 드롭·붙여넣기는 editorProps 대신 DOM에 직접 건다. 확장은 에디터를 만들 때
  // 한 번만 굳는데, 업로드 함수는 그 뒤에야 생기기 때문이다.
  // 툴바·`/사진`·`/파일` 이 쏘는 신호도 같은 자리에서 받는다.
  useEffect(() => {
    if (!editor) return
    const dom = editor.view.dom

    const onDrop = (event: DragEvent) => {
      const files = [...(event.dataTransfer?.files ?? [])]
      if (files.length === 0) return
      event.preventDefault()
      // 떨어뜨린 지점으로 커서를 먼저 옮긴다. 자리를 숫자로 들고 업로드를 기다리면 그 사이
      // 다른 사람의 편집에 밀려 엉뚱한 낱말 가운데에 들어간다. 커서는 편집을 따라 움직인다.
      const at = editor.view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
      if (at !== undefined) editor.commands.setTextSelection(at)
      void insert(files)
    }

    const onPaste = (event: ClipboardEvent) => {
      const files = [...(event.clipboardData?.files ?? [])]
      if (files.length === 0) return
      event.preventDefault()
      void insert(files)
    }

    const pick = async (accept: string) => {
      const file = await pickFile(accept)
      if (file) await insert([file])
    }
    const onPickImage = () => void pick('image/*')
    const onPickFile = () => void pick('')

    dom.addEventListener('drop', onDrop)
    dom.addEventListener('paste', onPaste)
    dom.addEventListener(PICK_IMAGE_EVENT, onPickImage)
    dom.addEventListener(PICK_FILE_EVENT, onPickFile)
    return () => {
      dom.removeEventListener('drop', onDrop)
      dom.removeEventListener('paste', onPaste)
      dom.removeEventListener(PICK_IMAGE_EVENT, onPickImage)
      dom.removeEventListener(PICK_FILE_EVENT, onPickFile)
    }
  }, [editor, insert])

  const clearError = useCallback(() => setError(null), [])

  return { uploading, error, clearError }
}
