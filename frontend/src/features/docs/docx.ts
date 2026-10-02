import type { JSONContent } from '@tiptap/core'
import { strToU8, zipSync } from 'fflate'
import { cleanName } from '@/lib/format'
import { uploadedFilePath } from '@/lib/links'
import { escapeXml } from '@/lib/xlsx'
import {
  bodyBlocks,
  columnWidths,
  hexColor,
  layoutTable,
  safeHref,
  sum,
  wholeNumber,
  type ExportSource,
  type PlacedCell,
} from './exportContent'

/** A4(11906) 에서 좌우 여백 1440 씩을 뺀 본문 폭. 길이 단위는 twip(1/20pt)이다. */
const PAGE_WIDTH = 9026
/** 쪽 높이(16838)에서 위아래 여백을 뺀 것. 사진이 이보다 길면 잘린다. */
const PAGE_HEIGHT = 13958
/** 목록·인용 한 단계의 들여쓰기. 편집기의 24px 과 같다. */
const STEP = 360
/** 들여쓰기는 본문 폭의 절반까지만. 수십 겹 중첩에서 글과 표가 놓일 폭이 음수가 되지 않게 한다. */
const MAX_INDENT = STEP * 12
/** 1px 은 15twip, 그림 단위(EMU)로는 9525 다(96dpi). */
const PX = 15
const EMU = 9525

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const PKG = 'http://schemas.openxmlformats.org/package/2006'
const DRAWING = 'http://schemas.openxmlformats.org/drawingml/2006'
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'

const FONT = '맑은 고딕'
const MONO = `<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:eastAsia="${FONT}" w:cs="Consolas"/>`
const SHADE = '<w:shd w:val="clear" w:color="auto" w:fill="F1F2F4"/>'
const JC = new Map([
  ['center', 'center'],
  ['right', 'right'],
  ['justify', 'both'],
])
/** 번호 매기기의 깊이는 0~8 아홉 단계다. 더 깊은 목록은 마지막 단계의 모양을 쓴다. */
const LEVELS = 9

/** 글이 놓이는 자리. 목록·인용·표 칸으로 들어갈 때마다 바뀐다. */
interface Ctx {
  indent: number
  /** 목록이 몇 겹인지. */
  depth: number
  quote: boolean
  cell: boolean
  /** 표의 머리 칸. 글을 전부 굵게 한다. */
  bold: boolean
}

/** 한 단계 안쪽. 목록 항목의 이어지는 블록과 인용문이 쓴다. */
const deeper = (ctx: Ctx): Ctx => ({ ...ctx, indent: Math.min(ctx.indent + STEP, MAX_INDENT) })

interface ParaOptions {
  style?: string
  num?: { id: number; level: number }
  /** 첫 줄의 기호(글머리·번호·체크 상자)만 왼쪽으로 내어 쓴다. */
  hanging?: boolean
  align?: unknown
  shade?: boolean
  /** 아래 테두리. 구분선이다. */
  rule?: boolean
}

/**
 * 문서를 Word(docx)로 만든다. docx 는 XML 몇 장을 zip 으로 묶은 것이라 엑셀(`lib/xlsx.ts`)처럼
 * 라이브러리 없이 손으로 쓴다. 본문은 편집기의 JSON 을 그대로 훑는다.
 *
 * `w:pPr`·`w:rPr`·`w:tcPr` 안의 요소는 규격이 정한 순서대로 써야 한다. 어긋나면 워드가 파일을
 * «손상됨» 으로 거부한다. 요소를 더할 때 순서를 지킨다.
 *
 * ponytail: 머리글·바닥글·쪽 번호·목차는 없다. 필요해지면 그때 docx 라이브러리로 간다.
 */
export function buildDocx({ title, doc, images, origin }: ExportSource): Uint8Array {
  const rels: string[] = []
  const media: Record<string, Uint8Array> = {}
  const imageRel = new Map<string, string>()
  /** 번호 목록마다 번호를 따로 센다. 1번은 글머리 목록이 쓰고, 여기 것은 2번부터다. */
  const ordered: { level: number; start: number }[] = []
  let drawings = 0

  const rel = (type: string, target: string, external = false) => {
    // rId1·rId2 는 styles·numbering 이 쓴다.
    const id = `rId${rels.length + 3}`
    rels.push(
      `<Relationship Id="${id}" Type="${R}/${type}" Target="${escapeXml(target)}"${external ? ' TargetMode="External"' : ''}/>`,
    )
    return id
  }

  const run = (inner: string, props = '') =>
    `<w:r>${props && `<w:rPr>${props}</w:rPr>`}${inner}</w:r>`

  /** 글자. 줄바꿈과 탭은 글자가 아니라 요소로 써야 워드가 알아본다. */
  const text = (value: string) =>
    value
      .split(/(\n|\t)/)
      .map((part) =>
        part === '\n'
          ? '<w:br/>'
          : part === '\t'
            ? '<w:tab/>'
            : part && `<w:t xml:space="preserve">${escapeXml(part)}</w:t>`,
      )
      .join('')

  const runProps = (marks: JSONContent['marks'], ctx: Ctx, link: boolean) => {
    const find = (type: string) => marks?.find((mark) => mark.type === type)
    const code = !!find('code')
    const color = hexColor(find('textStyle')?.attrs?.color)
    const highlight = find('highlight')
    const fill = highlight ? (hexColor(highlight.attrs?.color) ?? 'FEF08A') : null
    return [
      link && '<w:rStyle w:val="Hyperlink"/>',
      code && MONO,
      (ctx.bold || find('bold')) && '<w:b/>',
      find('italic') && '<w:i/>',
      find('strike') && '<w:strike/>',
      color && `<w:color w:val="${color}"/>`,
      find('underline') && '<w:u w:val="single"/>',
      fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : code && SHADE,
    ]
      .filter(Boolean)
      .join('')
  }

  const hyperlink = (href: string, inner: string) =>
    `<w:hyperlink r:id="${rel('hyperlink', href, true)}" w:history="1">${inner}</w:hyperlink>`

  const inlines = (node: JSONContent | undefined, ctx: Ctx): string =>
    (node?.content ?? [])
      .map((child) => {
        if (child.type === 'hardBreak') return run('<w:br/>')
        if (child.type === 'fileChip') {
          // 파일 자체는 담지 않는다. 이름을 남기고 서버의 그 파일로 링크를 건다.
          const label = text(`[첨부] ${cleanName(String(child.attrs?.name ?? ''))}`)
          const path = uploadedFilePath(child.attrs?.src)
          return path
            ? hyperlink(origin + path, run(label, runProps([], ctx, true)))
            : run(label, runProps([], ctx, false))
        }
        if (child.type !== 'text') return ''
        const href = safeHref(child.marks?.find((mark) => mark.type === 'link')?.attrs?.href)
        const body = run(text(child.text ?? ''), runProps(child.marks, ctx, !!href))
        return href ? hyperlink(href, body) : body
      })
      .join('')

  const para = (runs: string, ctx: Ctx, options: ParaOptions = {}) => {
    const indent = ctx.indent + (options.hanging ? STEP : 0)
    const jc = JC.get(String(options.align))
    const border =
      (ctx.quote ? '<w:left w:val="single" w:sz="12" w:space="8" w:color="C4C8CF"/>' : '') +
      (options.rule ? '<w:bottom w:val="single" w:sz="6" w:space="1" w:color="C4C8CF"/>' : '')
    const props = [
      options.style && `<w:pStyle w:val="${options.style}"/>`,
      options.num &&
        `<w:numPr><w:ilvl w:val="${options.num.level}"/><w:numId w:val="${options.num.id}"/></w:numPr>`,
      border && `<w:pBdr>${border}</w:pBdr>`,
      options.shade && SHADE,
      // 표 칸 안은 문단 사이를 붙이고 줄 간격도 한 줄로 좁힌다. 본문 간격 그대로면 표가 두 배로 길어진다.
      ctx.cell && '<w:spacing w:after="0" w:line="240" w:lineRule="auto"/>',
      indent > 0 && `<w:ind w:left="${indent}"${options.hanging ? ` w:hanging="${STEP}"` : ''}/>`,
      jc && `<w:jc w:val="${jc}"/>`,
    ]
      .filter(Boolean)
      .join('')
    return `<w:p>${props && `<w:pPr>${props}</w:pPr>`}${runs}</w:p>`
  }

  /**
   * 목록. 항목의 첫 문단에 기호를 달고, 그 항목의 나머지 블록(이어지는 문단·안쪽 목록)은 글이
   * 시작하는 자리에 맞춰 들여 쓴다.
   */
  const list = (
    node: JSONContent,
    ctx: Ctx,
    marker: (item: JSONContent) => { num?: ParaOptions['num']; prefix?: string },
  ) =>
    (node.content ?? [])
      .map((item) => {
        const children = item.content ?? []
        const lead = children[0]?.type === 'paragraph' ? children[0] : undefined
        const { num, prefix } = marker(item)
        return (
          para((prefix ? run(text(prefix)) : '') + inlines(lead, ctx), ctx, {
            num,
            hanging: true,
            align: lead?.attrs?.textAlign,
          }) + blocks(lead ? children.slice(1) : children, { ...deeper(ctx), depth: ctx.depth + 1 })
        )
      })
      .join('')

  const table = (node: JSONContent, ctx: Ctx) => {
    const { rows, columns } = layoutTable(node)
    if (!columns.length) return ''
    const grid = columnWidths(columns, (PAGE_WIDTH - ctx.indent) / PX).map((px) =>
      Math.floor(px * PX),
    )
    const inner: Ctx = { indent: 0, depth: 0, quote: false, cell: true, bold: false }

    const cell = ({ node: cellNode, col, colspan, rowspan }: PlacedCell) => {
      const header = cellNode?.type === 'tableHeader'
      const merge = !cellNode ? '<w:vMerge/>' : rowspan > 1 ? '<w:vMerge w:val="restart"/>' : ''
      // 칸은 문단으로 끝나야 한다. 빈 칸에도 문단 하나를 넣는다.
      const body = (cellNode && blocks(cellNode.content, { ...inner, bold: header })) || '<w:p/>'
      return (
        `<w:tc><w:tcPr><w:tcW w:w="${sum(grid.slice(col, col + colspan))}" w:type="dxa"/>` +
        (colspan > 1 ? `<w:gridSpan w:val="${colspan}"/>` : '') +
        merge +
        (header ? SHADE : '') +
        `</w:tcPr>${body}</w:tc>`
      )
    }

    const edge = (side: string) =>
      `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="C4C8CF"/>`
    return (
      `<w:tbl><w:tblPr><w:tblW w:w="${sum(grid)}" w:type="dxa"/>` +
      (ctx.indent ? `<w:tblInd w:w="${ctx.indent}" w:type="dxa"/>` : '') +
      `<w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(edge).join('')}</w:tblBorders>` +
      `<w:tblLayout w:type="fixed"/>` +
      `<w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="120" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tblCellMar>` +
      `</w:tblPr><w:tblGrid>${grid.map((width) => `<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>` +
      rows
        .filter((row) => row.length > 0)
        .map((row) => `<w:tr>${row.map(cell).join('')}</w:tr>`)
        .join('') +
      `</w:tbl>`
    )
  }

  const picture = (node: JSONContent, ctx: Ctx) => {
    const src = String(node.attrs?.src ?? '')
    const image = images.get(src)
    const captionRuns = inlines(node, ctx)
    const caption = captionRuns ? para(captionRuns, ctx, { style: 'Caption' }) : ''
    if (!image || !image.width || !image.height) {
      const note = run(text('[사진을 불러오지 못했습니다]'), '<w:i/><w:color w:val="8A8F98"/>')
      return para(note, ctx) + caption
    }

    let id = imageRel.get(src)
    if (!id) {
      const name = `image${imageRel.size + 1}.${image.ext}`
      media[`word/media/${name}`] = image.bytes
      id = rel('image', `media/${name}`)
      imageRel.set(src, id)
    }

    // 편집기에서 줄여 둔 폭을 따르되 본문 폭도 쪽 높이도 넘기지 않는다. 세로로 긴 화면 캡처는
    // 폭만 맞추면 쪽 아래로 잘린다.
    const wanted = Number(node.attrs?.width) || image.width
    const width = Math.max(
      1,
      Math.min(
        Number.isFinite(wanted) ? wanted : image.width,
        (PAGE_WIDTH - ctx.indent) / PX,
        (PAGE_HEIGHT / PX) * (image.width / image.height),
      ),
    )
    const size = `cx="${Math.round(width * EMU)}" cy="${Math.round(((width * image.height) / image.width) * EMU)}"`
    drawings += 1
    const alt = escapeXml(String(node.attrs?.alt ?? ''))
    const drawing =
      `<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent ${size}/>` +
      `<wp:docPr id="${drawings}" name="사진 ${drawings}" descr="${alt}"/>` +
      `<a:graphic xmlns:a="${DRAWING}/main"><a:graphicData uri="${DRAWING}/picture">` +
      `<pic:pic xmlns:pic="${DRAWING}/picture">` +
      `<pic:nvPicPr><pic:cNvPr id="${drawings}" name="사진 ${drawings}"/><pic:cNvPicPr/></pic:nvPicPr>` +
      `<pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
      `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext ${size}/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
      `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>`
    return para(run(drawing), ctx) + caption
  }

  const block = (node: JSONContent, ctx: Ctx): string => {
    const align = node.attrs?.textAlign
    switch (node.type) {
      case 'paragraph':
        return para(inlines(node, ctx), ctx, { align })
      case 'heading': {
        return para(inlines(node, ctx), ctx, {
          style: `Heading${wholeNumber(node.attrs?.level, 1, 6)}`,
          align,
        })
      }
      case 'bulletList':
        return list(node, ctx, () => ({ num: { id: 1, level: Math.min(ctx.depth, LEVELS - 1) } }))
      case 'orderedList': {
        const level = Math.min(ctx.depth, LEVELS - 1)
        const id = ordered.push({ level, start: wholeNumber(node.attrs?.start, 0, 32767) }) + 1
        return list(node, ctx, () => ({ num: { id, level } }))
      }
      case 'taskList':
        // 탭이 글을 내어 쓴 자리까지 민다. 기호 폭이 달라도 글의 왼쪽이 맞는다.
        return list(node, ctx, (item) => ({ prefix: item.attrs?.checked ? '☑\t' : '☐\t' }))
      case 'blockquote':
        return blocks(node.content, { ...deeper(ctx), quote: true })
      case 'codeBlock': {
        const code = (node.content ?? []).map((child) => child.text ?? '').join('')
        return para(run(text(code), `${MONO}<w:sz w:val="20"/>`), ctx, { shade: true })
      }
      case 'horizontalRule':
        return para('', ctx, { rule: true })
      case 'table':
        return table(node, ctx)
      case 'imageBlock':
        return picture(node, ctx)
      default:
        // 모르는 블록은 버리지 않고 안의 것을 꺼내 쓴다.
        return blocks(node.content, ctx)
    }
  }

  // 표 둘이 맞닿으면 워드가 한 표로 이어 그린다. 사이에 빈 문단을 끼워 가른다.
  // 본문 글자는 이스케이프되어 있어 이 문자열이 내용에서 나올 수 없다.
  const blocks = (nodes: JSONContent[] | undefined, ctx: Ctx): string =>
    (nodes ?? [])
      .map((node) => block(node, ctx))
      .join('')
      .replaceAll('</w:tbl><w:tbl>', '</w:tbl><w:p/><w:tbl>')

  const root: Ctx = { indent: 0, depth: 0, quote: false, cell: false, bold: false }
  const body =
    para(run(text(title)), root, { style: 'Title' }) +
    blocks(bodyBlocks(doc), root) +
    `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>`

  const levels = (fmt: string, label: (level: number) => string) =>
    Array.from(
      { length: LEVELS },
      (_, level) =>
        `<w:lvl w:ilvl="${level}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${label(level)}"/><w:lvlJc w:val="left"/>` +
        `<w:pPr><w:ind w:left="${STEP * (level + 1)}" w:hanging="${STEP}"/></w:pPr></w:lvl>`,
    ).join('')

  const heading = (level: number, size: number) =>
    `<w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="heading ${level}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/>` +
    `<w:pPr><w:keepNext/><w:spacing w:before="${level < 3 ? 360 : 240}" w:after="120"/><w:outlineLvl w:val="${level - 1}"/></w:pPr>` +
    `<w:rPr><w:b/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr></w:style>`

  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `${XML}<Types xmlns="${PKG}/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Default Extension="png" ContentType="image/png"/>` +
        `<Default Extension="jpeg" ContentType="image/jpeg"/>` +
        `<Default Extension="gif" ContentType="image/gif"/>` +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
        `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` +
        `<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>` +
        `</Types>`,
    ),
    '_rels/.rels': strToU8(
      `${XML}<Relationships xmlns="${PKG}/relationships">` +
        `<Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/>` +
        `</Relationships>`,
    ),
    'word/document.xml': strToU8(
      `${XML}<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="${DRAWING}/wordprocessingDrawing">` +
        `<w:body>${body}</w:body></w:document>`,
    ),
    'word/_rels/document.xml.rels': strToU8(
      `${XML}<Relationships xmlns="${PKG}/relationships">` +
        `<Relationship Id="rId1" Type="${R}/styles" Target="styles.xml"/>` +
        `<Relationship Id="rId2" Type="${R}/numbering" Target="numbering.xml"/>` +
        rels.join('') +
        `</Relationships>`,
    ),
    // 본문 11pt·줄 간격 1.15(맑은 고딕은 글꼴 자체의 줄 높이가 커서 이 정도가 편집기와 비슷하다), 문단 사이 8pt.
    // autoSpace 를 끈다: 켜 두면 워드가 한글과 숫자·영문 사이를 벌려 «9월» 이 «9 월» 로 보인다.
    // 제목 이름은 워드가 아는 것(heading 1)이라 탐색 창에 잡힌다.
    'word/styles.xml': strToU8(
      `${XML}<w:styles xmlns:w="${W}"><w:docDefaults>` +
        `<w:rPrDefault><w:rPr><w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}" w:eastAsia="${FONT}" w:cs="${FONT}"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US" w:eastAsia="ko-KR"/></w:rPr></w:rPrDefault>` +
        `<w:pPrDefault><w:pPr><w:autoSpaceDE w:val="0"/><w:autoSpaceDN w:val="0"/><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault>` +
        `</w:docDefaults>` +
        `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>` +
        `<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="48"/><w:szCs w:val="48"/></w:rPr></w:style>` +
        [36, 30, 24, 22, 22, 22].map((size, i) => heading(i + 1, size)).join('') +
        `<w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/><w:basedOn w:val="Normal"/><w:rPr><w:color w:val="8A8F98"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style>` +
        `<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>` +
        `</w:styles>`,
    ),
    // 0번 틀은 글머리, 1번 틀은 번호. 번호 목록은 목록마다 번호표(w:num)를 따로 받아 1부터 다시 센다.
    'word/numbering.xml': strToU8(
      `${XML}<w:numbering xmlns:w="${W}">` +
        `<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>${levels('bullet', () => '•')}</w:abstractNum>` +
        `<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${levels('decimal', (level) => `%${level + 1}.`)}</w:abstractNum>` +
        `<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>` +
        ordered
          .map(
            ({ level, start }, i) =>
              `<w:num w:numId="${i + 2}"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="${level}"><w:startOverride w:val="${start}"/></w:lvlOverride></w:num>`,
          )
          .join('') +
        `</w:numbering>`,
    ),
    ...media,
  }
  return zipSync(files, { level: 6 })
}
