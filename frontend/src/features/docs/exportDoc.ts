import type { Editor } from '@tiptap/react'
import { apiBytes } from '@/lib/api'
import { downloadBytes } from '@/lib/download'
import { uploadedFilePath } from '@/lib/links'
import { httpUrl, serverOrigin } from '@/lib/serverOrigin'
import { buildDocx } from './docx'
import { exportFileStem, imageSources, type ExportImage } from './exportContent'
import { buildHwpx } from './hwpx'

export type ExportFormat = 'docx' | 'hwpx' | 'pdf'

/** 파일로 만드는 형식. PDF 는 파일을 만들지 않고 인쇄 창으로 간다. */
const FILES = {
  docx: {
    build: buildDocx,
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  hwpx: { build: buildHwpx, type: 'application/hwp+zip' },
}

/** 파일 머리의 서명으로 형식을 본다. 이름의 확장자는 믿지 않는다. */
function sniff(bytes: Uint8Array): ExportImage['ext'] | null {
  const starts = (...head: number[]) => head.every((byte, i) => bytes[i] === byte)
  if (starts(0x89, 0x50, 0x4e, 0x47)) return 'png'
  if (starts(0xff, 0xd8, 0xff)) return 'jpeg'
  if (starts(0x47, 0x49, 0x46, 0x38)) return 'gif'
  return null
}

/**
 * 서버에서 사진을 받아 크기를 잰다. png·gif 는 받은 그대로 싣고, 나머지는 다시 그려 싣는다.
 *
 * - webp 는 워드·한글이 못 읽는다. PNG 로 바꾼다(투명한 바탕이 살아야 해서 JPEG 이 아니다).
 * - JPEG 은 세워 찍은 폰 사진이 "눕혀 저장하고 돌려 보라" 는 표시(EXIF)만 달고 온다. 브라우저는
 *   그 표시대로 세워 그리지만 워드·한글은 따르지 않아, 그대로 실으면 사진이 눕고 비율까지 뒤바뀐다.
 *   세워 그린 결과를 JPEG 으로 다시 담는다.
 */
async function loadImage(path: string): Promise<ExportImage> {
  const bytes = await apiBytes(path.slice('/api'.length))
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart]))
  try {
    const { width, height } = bitmap
    const ext = sniff(bytes)
    if (ext === 'png' || ext === 'gif') return { bytes, ext, width, height }

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
    const redrawn = ext ?? 'png'
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, `image/${redrawn}`, 0.92),
    )
    if (!blob) throw new Error('사진을 다시 그리지 못했습니다.')
    return { bytes: new Uint8Array(await blob.arrayBuffer()), ext: redrawn, width, height }
  } finally {
    bitmap.close()
  }
}

/**
 * 본문의 사진을 받아 온다. 못 받은 사진(지워졌거나 권한이 없거나 바깥 주소)은 결과에서 빠지고,
 * 파일에는 그 자리에 안내 글이 들어간다. 사진 한 장 때문에 내보내기 전체를 막지 않는다.
 *
 * 올린 파일(`/api/files/{id}`)만 받는다. 바깥 주소의 사진은 요청을 사내망 밖으로 내보내게 된다.
 */
async function loadImages(sources: string[]): Promise<Map<string, ExportImage>> {
  const images = new Map<string, ExportImage>()
  await Promise.all(
    sources.map(async (src) => {
      const path = uploadedFilePath(src)
      if (!path) return
      try {
        images.set(src, await loadImage(path))
      } catch {
        // 빠진 수는 호출한 쪽이 세어 알린다.
      }
    }),
  )
  return images
}

/** 지난 인쇄가 남긴 것(본문 사본, 바꿔 둔 탭 제목)을 치운다. 치울 게 없으면 아무 일도 없다. */
let endPrint = () => {}

/**
 * 브라우저의 인쇄 창을 연다. 거기서 "PDF로 저장" 을 고르면 PDF 가 된다.
 * 돌려주는 값은 그려지지 않은 사진 수다.
 *
 * PDF 를 직접 만들려면 한글 글꼴을 파일에 심는 라이브러리가 필요하다. 브라우저가 이미 화면 그대로
 * PDF 를 만들 줄 알아 그쪽에 맡긴다. 본문 사본을 body 끝에 붙이면 `index.css` 의 인쇄 규칙이
 * 앱을 숨기고 그 사본만 찍는다.
 *
 * ponytail: `afterprint` 를 안 쏘는 브라우저에서는 사본과 탭 제목이 다음 내보내기 때까지 남는다.
 * 사본은 화면에 보이지 않지만, 그동안 다른 화면에서 Ctrl+P 를 누르면 이 문서가 찍힌다.
 */
async function printDoc(title: string, editor: Editor): Promise<number> {
  // 지난 인쇄가 끝났다는 신호를 못 받았을 수 있다. 그 뒷정리부터 해야 탭 제목이 제자리로 돌아간다.
  endPrint()

  const page = document.createElement('div')
  page.className = 'zenith-print'
  const heading = document.createElement('h1')
  heading.textContent = title
  const body = document.createElement('div')
  body.className = 'zenith-editor'
  // 편집기가 스키마로 직렬화한 HTML 이다. 스키마에 없는 태그·속성은 실리지 않는다(복사할 때와 같은 출력).
  body.innerHTML = editor.getHTML()
  // 끝의 빈 문단은 뗀다. 종이에서는 그 한 줄이 넘쳐 빈 쪽을 만든다(`bodyBlocks` 와 같은 이유).
  while (body.lastElementChild?.matches('p:empty')) body.lastElementChild.remove()
  page.append(heading, body)

  const images = [...page.querySelectorAll('img')]
  for (const image of images) {
    // 저장된 주소는 상대경로다. 데스크탑 셸에서는 서버 주소를 붙여야 그려진다(`ImageBlockView`).
    const src = image.getAttribute('src')
    if (src?.startsWith('/')) image.src = httpUrl(src)
  }

  const tabTitle = document.title
  endPrint = () => {
    document.title = tabTitle
    page.remove()
    window.removeEventListener('afterprint', endPrint)
    endPrint = () => {}
  }
  document.body.append(page)
  // 사진이 다 그려진 뒤에 찍는다. 못 받은 사진은 빈 채로 두고 수만 센다.
  const drawn = await Promise.all(
    images.map((image) =>
      image.decode().then(
        () => true,
        () => false,
      ),
    ),
  )

  // 인쇄 창이 제안하는 PDF 파일 이름은 탭의 제목이다.
  document.title = exportFileStem(title)
  window.addEventListener('afterprint', endPrint)
  window.print()
  return drawn.filter((ok) => !ok).length
}

/**
 * 문서를 파일로 내보낸다. 본문은 지금 편집기에 있는 그대로다(서버에 다녀오지 않는다).
 * 돌려주는 값은 파일에 넣지 못한 사진 수다.
 */
export async function exportDoc(
  format: ExportFormat,
  title: string,
  editor: Editor,
): Promise<{ missingImages: number }> {
  if (format === 'pdf') return { missingImages: await printDoc(title, editor) }

  const doc = editor.getJSON()
  const sources = imageSources(doc)
  const images = await loadImages(sources)
  const { build, type } = FILES[format]
  const bytes = build({ title, doc, images, origin: serverOrigin() || location.origin })
  downloadBytes(`${exportFileStem(title)}.${format}`, bytes, type)
  return { missingImages: sources.length - images.size }
}
