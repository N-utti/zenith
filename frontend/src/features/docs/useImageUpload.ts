import { useCallback, useEffect, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { ApiError } from '@/lib/api'
import { uploadFile } from './api'
import { PICK_IMAGE_EVENT } from './ImageBlock'

/** 서버(목 핸들러)와 같은 상한. 여기서 먼저 걸러야 10MB를 올렸다가 413을 보는 일이 없다. */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024

function imagesFrom(list: FileList | null | undefined): File[] {
  return [...(list ?? [])].filter((file) => file.type.startsWith('image/'))
}

/** 파일 선택 창. input을 화면에 두지 않아도 되도록 그때그때 만든다. */
function pickImageFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = () => resolve(input.files?.[0] ?? null)
    input.oncancel = () => resolve(null)
    input.click()
  })
}

/**
 * 사진 첨부. 업로드는 `/api/files` 로 보내고 본문에는 받은 url만 넣는다.
 * 바이너리를 Y.Doc에 담으면 문서가 사진 크기만큼 영구히 불어나고,
 * 버전 스냅샷마다 복사된다.
 */
export function useImageUpload(editor: Editor | null) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const insert = useCallback(
    async (files: File[], at?: number) => {
      if (!editor || files.length === 0) return

      const tooBig = files.find((file) => file.size > MAX_IMAGE_BYTES)
      if (tooBig) {
        setError(`${tooBig.name}: 10MB 이하 이미지만 올릴 수 있습니다.`)
        return
      }

      setUploading(true)
      setError(null)
      try {
        // 여러 장을 떨어뜨리면 떨어뜨린 순서대로 쌓인다.
        for (const file of files) {
          const uploaded = await uploadFile(file)
          const chain = editor.chain().focus()
          if (at !== undefined) chain.setTextSelection(at)
          chain.setImageBlock({ src: uploaded.url, alt: file.name }).run()
        }
      } catch (cause) {
        setError(cause instanceof ApiError ? cause.message : '사진을 올리지 못했습니다.')
      } finally {
        setUploading(false)
      }
    },
    [editor],
  )

  const pick = useCallback(async () => {
    const file = await pickImageFile()
    if (file) await insert([file])
  }, [insert])

  // 드롭·붙여넣기는 editorProps 대신 DOM에 직접 건다. 확장은 에디터를 만들 때
  // 한 번만 굳는데, 업로드 함수는 그 뒤에야 생기기 때문이다.
  // 툴바·`/사진` 이 쏘는 신호도 같은 자리에서 받는다.
  useEffect(() => {
    if (!editor) return
    const dom = editor.view.dom

    const onDrop = (event: DragEvent) => {
      const files = imagesFrom(event.dataTransfer?.files)
      if (files.length === 0) return
      event.preventDefault()
      // 떨어뜨린 지점에 넣는다. 자리를 못 잡으면 현재 커서 자리로 둔다.
      const at = editor.view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
      void insert(files, at)
    }

    const onPaste = (event: ClipboardEvent) => {
      const files = imagesFrom(event.clipboardData?.files)
      if (files.length === 0) return
      event.preventDefault()
      void insert(files)
    }

    const onPickRequest = () => void pick()

    dom.addEventListener('drop', onDrop)
    dom.addEventListener('paste', onPaste)
    dom.addEventListener(PICK_IMAGE_EVENT, onPickRequest)
    return () => {
      dom.removeEventListener('drop', onDrop)
      dom.removeEventListener('paste', onPaste)
      dom.removeEventListener(PICK_IMAGE_EVENT, onPickRequest)
    }
  }, [editor, insert, pick])

  const clearError = useCallback(() => setError(null), [])

  return { pick, uploading, error, clearError }
}
