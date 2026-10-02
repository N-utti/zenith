import type { JSONContent } from '@tiptap/core'
import { strToU8, zipSync, type Zippable } from 'fflate'
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
} from './exportContent'

/** 길이 단위(HWPUNIT)는 1/7200 인치다. 1px 은 75, 1pt 는 100. */
const PX = 75
/**
 * A4(59528) 에서 좌우 여백 20mm(5669)씩을 뺀 본문 폭. 한글 새 문서의 기본은 30mm 인데, 그러면 본문이
 * 편집기보다 좁아져 표의 열이 눌린다. 20mm 면 편집기 본문 폭과 거의 같다(642px).
 */
const MARGIN = 5669
const PAGE_WIDTH = 59528 - MARGIN * 2
/**
 * 사진 높이의 상한. 쪽 본문 높이(65762)보다 넉넉히 작게 잡는다. 사진은 글자처럼 줄에 놓이고 그 줄에
 * 줄 간격 160% 가 걸리는데, 줄이 쪽보다 높아지면 사진이 다음 쪽으로 밀려 빈 쪽이 생길 수 있다.
 */
const PAGE_HEIGHT = 40000
/** 목록·인용 한 단계의 들여쓰기. 편집기의 24px 과 같다. */
const STEP = 24 * PX
const MAX_INDENT = STEP * 11

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>'
const HWPML = 'http://www.hancom.co.kr/hwpml'
/** header 와 section 의 루트는 이 15개를 전부 선언한다(한글이 만든 문서가 그렇다). */
const NS =
  `xmlns:ha="${HWPML}/2011/app" xmlns:hp="${HWPML}/2011/paragraph" xmlns:hp10="${HWPML}/2016/paragraph" ` +
  `xmlns:hs="${HWPML}/2011/section" xmlns:hc="${HWPML}/2011/core" xmlns:hh="${HWPML}/2011/head" ` +
  `xmlns:hhs="${HWPML}/2011/history" xmlns:hm="${HWPML}/2011/master-page" ` +
  `xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf" xmlns:dc="http://purl.org/dc/elements/1.1/" ` +
  `xmlns:opf="http://www.idpf.org/2007/opf/" xmlns:ooxmlchart="${HWPML}/2016/ooxmlchart" ` +
  `xmlns:hwpunitchar="${HWPML}/2016/HwpUnitChar" xmlns:epub="http://www.idpf.org/2007/ops" ` +
  `xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0"`

const LINE = 'C4C8CF'
const FILL = 'F1F2F4'
const GRAY = '8A8F98'
const LINK = '0563C1'
/** 테두리·배경 번호. 1·2 는 한글 새 문서의 기본(쪽 테두리, 글자·문단 기본)이다. */
const BORDER = { cell: 3, headerCell: 4, quote: 5, rule: 6, code: 7 }
/** 하이퍼링크 필드에 한글이 주는 고정 번호. */
const LINK_FIELD = '627600491'
const ALIGN = new Map([
  ['center', 'CENTER'],
  ['right', 'RIGHT'],
  ['justify', 'JUSTIFY'],
])
const LANGS = ['hangul', 'latin', 'hanja', 'japanese', 'other', 'symbol', 'user']
const eachLang = (value: number) => LANGS.map((lang) => `${lang}="${value}"`).join(' ')

/** 글자 모양. 같은 모양은 header 에 한 번만 적고 본문은 번호로 가리킨다. */
interface Char {
  /** 글자 크기. 1/100pt. */
  height: number
  color: string
  /** 글자 뒤 음영. 없으면 `null`. */
  shade: string | null
  bold: boolean
  italic: boolean
  underline: boolean
  strike: boolean
  /** 고정폭 글꼴(코드). */
  mono: boolean
}
const CHAR: Char = {
  height: 1000,
  color: '000000',
  shade: null,
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  mono: false,
}

/** 문단 모양. 글자 모양과 마찬가지로 header 에 적고 번호로 가리킨다. */
interface Para {
  align: string
  /** 목록 기호. `hh:heading` 의 속성이다. */
  heading: string
  left: number
  /** 문단 위·아래 간격. */
  prev: number
  next: number
  border: number
}
const PARA: Para = {
  align: 'LEFT',
  heading: 'type="NONE" idRef="0" level="0"',
  left: 0,
  prev: 0,
  next: 600,
  border: 2,
}

/** 글이 놓이는 자리. 목록·인용·표 칸으로 들어갈 때마다 바뀐다. */
interface Ctx {
  indent: number
  /** 목록이 몇 겹인지. */
  depth: number
  quote: boolean
  cell: boolean
  /** 표의 머리 칸. 글을 전부 굵게 한다. */
  bold: boolean
  /** 글자 크기. 제목과 사진 설명이 정한다. */
  size?: number
  /** 글자색. 사진 설명이 흐리게 쓴다. */
  color?: string
}
const deeper = (ctx: Ctx): Ctx => ({ ...ctx, indent: Math.min(ctx.indent + STEP, MAX_INDENT) })

function borderFill(
  id: number,
  sides: string[],
  width: string,
  color: string,
  fill?: { face: string; hatch: string },
): string {
  const side = (name: string) =>
    `<hh:${name}Border type="${sides.includes(name) ? 'SOLID' : 'NONE'}" width="${width}" color="#${color}"/>`
  return (
    `<hh:borderFill id="${id}" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0">` +
    `<hh:slash type="NONE" Crooked="0" isCounter="0"/><hh:backSlash type="NONE" Crooked="0" isCounter="0"/>` +
    ['left', 'right', 'top', 'bottom'].map(side).join('') +
    `<hh:diagonal type="SOLID" width="0.1 mm" color="#000000"/>` +
    (fill
      ? `<hc:fillBrush><hc:winBrush faceColor="${fill.face}" hatchColor="${fill.hatch}" alpha="0"/></hc:fillBrush>`
      : '') +
    `</hh:borderFill>`
  )
}

function charPr(id: number, char: Char): string {
  return (
    `<hh:charPr id="${id}" height="${char.height}" textColor="#${char.color}" shadeColor="${char.shade ? `#${char.shade}` : 'none'}" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="2">` +
    `<hh:fontRef ${eachLang(char.mono ? 1 : 0)}/><hh:ratio ${eachLang(100)}/><hh:spacing ${eachLang(0)}/><hh:relSz ${eachLang(100)}/><hh:offset ${eachLang(0)}/>` +
    (char.italic ? '<hh:italic/>' : '') +
    (char.bold ? '<hh:bold/>' : '') +
    `<hh:underline type="${char.underline ? 'BOTTOM' : 'NONE'}" shape="SOLID" color="#${char.color}"/>` +
    `<hh:strikeout shape="${char.strike ? 'SOLID' : 'NONE'}" color="#${char.color}"/>` +
    `<hh:outline type="NONE"/><hh:shadow type="NONE" color="#C0C0C0" offsetX="10" offsetY="10"/>` +
    `</hh:charPr>`
  )
}

function paraPr(id: number, para: Para): string {
  // 여백은 두 갈래에 다른 값으로 적는다. 새 판이 읽는 쪽(hp:case)에는 실제 값, 옛 판이 읽는 쪽
  // (hp:default)에는 그 두 배다. 한글이 그렇게 쓰고, 한쪽만 적으면 판에 따라 두 배로 읽힌다.
  const margin = (scale: number) =>
    `<hh:margin><hc:intent value="0" unit="HWPUNIT"/><hc:left value="${para.left * scale}" unit="HWPUNIT"/><hc:right value="0" unit="HWPUNIT"/>` +
    `<hc:prev value="${para.prev * scale}" unit="HWPUNIT"/><hc:next value="${para.next * scale}" unit="HWPUNIT"/></hh:margin>` +
    `<hh:lineSpacing type="PERCENT" value="160" unit="HWPUNIT"/>`
  // 테두리가 있는 문단(인용의 왼쪽 선, 코드의 바탕)은 글과 테두리 사이를 2mm 띄운다.
  const offset = para.border === 2 ? 0 : 567
  return (
    `<hh:paraPr id="${id}" tabPrIDRef="0" condense="0" fontLineHeight="0" snapToGrid="1" suppressLineNumbers="0" checked="0" textDir="LTR">` +
    `<hh:align horizontal="${para.align}" vertical="BASELINE"/><hh:heading ${para.heading}/>` +
    `<hh:breakSetting breakLatinWord="KEEP_WORD" breakNonLatinWord="BREAK_WORD" widowOrphan="0" keepWithNext="0" keepLines="0" pageBreakBefore="0" lineWrap="BREAK"/>` +
    `<hh:autoSpacing eAsianEng="0" eAsianNum="0"/>` +
    `<hp:switch><hp:case hp:required-namespace="${HWPML}/2016/HwpUnitChar">${margin(1)}</hp:case><hp:default>${margin(2)}</hp:default></hp:switch>` +
    `<hh:border borderFillIDRef="${para.border}" offsetLeft="${offset}" offsetRight="${offset}" offsetTop="${offset}" offsetBottom="${offset}" connect="0" ignoreMargin="0"/>` +
    `</hh:paraPr>`
  )
}

const paraHead = (level: number, start: number, format: string, text: string, checkable = 0) =>
  `<hh:paraHead start="${start}" level="${level}" align="LEFT" useInstWidth="1" autoIndent="1" widthAdjust="0" textOffsetType="PERCENT" textOffset="50" numFormat="${format}" charPrIDRef="4294967295" checkable="${checkable}">${text}</hh:paraHead>`

/** 한글 새 문서의 개요 번호. 본문의 구역 설정이 이 1번을 가리키므로 빠지면 안 된다. */
const OUTLINE =
  `<hh:numbering id="1" start="0">` +
  (
    [
      ['DIGIT', '^1.', 0],
      ['HANGUL_SYLLABLE', '^2.', 0],
      ['DIGIT', '^3)', 0],
      ['HANGUL_SYLLABLE', '^4)', 0],
      ['DIGIT', '(^5)', 0],
      ['HANGUL_SYLLABLE', '(^6)', 0],
      ['CIRCLED_DIGIT', '^7', 1],
      ['CIRCLED_HANGUL_SYLLABLE', '^8', 1],
      ['HANGUL_JAMO', '', 0],
      ['ROMAN_SMALL', '', 1],
    ] as const
  )
    .map(([format, text, checkable], i) => paraHead(i + 1, 1, format, text, checkable))
    .join('') +
  `</hh:numbering>`

const noteLine = (length: string) =>
  `<hp:noteLine length="${length}" type="SOLID" width="0.12 mm" color="#000000"/>`
const pageBorder = (type: string) =>
  `<hp:pageBorderFill type="${type}" borderFillIDRef="1" textBorder="PAPER" headerInside="0" footerInside="0" fillArea="PAPER"><hp:offset left="1417" right="1417" top="1417" bottom="1417"/></hp:pageBorderFill>`
/** 쪽 설정. 문서의 첫 문단 첫 run 에 들어가야 한다. 좌우 여백 말고는 한글 새 문서의 값 그대로다(A4). */
const SECTION_SETUP =
  `<hp:secPr id="" textDirection="HORIZONTAL" spaceColumns="1134" tabStop="8000" tabStopVal="4000" tabStopUnit="HWPUNIT" outlineShapeIDRef="1" memoShapeIDRef="0" textVerticalWidthHead="0" masterPageCnt="0">` +
  `<hp:grid lineGrid="0" charGrid="0" wonggojiFormat="0"/><hp:startNum pageStartsOn="BOTH" page="0" pic="0" tbl="0" equation="0"/>` +
  `<hp:visibility hideFirstHeader="0" hideFirstFooter="0" hideFirstMasterPage="0" border="SHOW_ALL" fill="SHOW_ALL" hideFirstPageNum="0" hideFirstEmptyLine="0" showLineNumber="0"/>` +
  `<hp:lineNumberShape restartType="0" countBy="0" distance="0" startNumber="0"/>` +
  `<hp:pagePr landscape="WIDELY" width="59528" height="84186" gutterType="LEFT_ONLY"><hp:margin header="4252" footer="4252" gutter="0" left="${MARGIN}" right="${MARGIN}" top="5668" bottom="4252"/></hp:pagePr>` +
  `<hp:footNotePr><hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/>${noteLine('-1')}<hp:noteSpacing betweenNotes="283" belowLine="567" aboveLine="850"/><hp:numbering type="CONTINUOUS" newNum="1"/><hp:placement place="EACH_COLUMN" beneathText="0"/></hp:footNotePr>` +
  `<hp:endNotePr><hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/>${noteLine('14692344')}<hp:noteSpacing betweenNotes="0" belowLine="567" aboveLine="850"/><hp:numbering type="CONTINUOUS" newNum="1"/><hp:placement place="END_OF_DOCUMENT" beneathText="0"/></hp:endNotePr>` +
  ['BOTH', 'EVEN', 'ODD'].map(pageBorder).join('') +
  `</hp:secPr><hp:ctrl><hp:colPr id="" type="NEWSPAPER" layout="LEFT" colCount="1" sameSz="1" sameGap="0"/></hp:ctrl>`

/**
 * 문서를 한글(hwpx)로 만든다. hwpx 도 XML 몇 장을 zip 으로 묶은 것이라 docx(`docx.ts`)와 같은
 * 방식으로 손으로 쓴다. 옛 형식인 hwp 는 바이너리라 만들지 않는다. 한글 2020 에서 여는 것을 확인했다.
 *
 * docx 와 다른 점: 서식을 글 옆에 적지 않는다. 글자 모양·문단 모양을 header.xml 에 표로 모아
 * 두고 본문은 번호로 가리킨다. 그래서 본문을 먼저 만들면서 쓰인 모양을 모으고, header 를 나중에 쓴다.
 *
 * 구조는 한글이 직접 만든 빈 문서를 따랐다. 틀리면 한글이 문서를 열지 않는 자리가 많다
 * (쪽 설정이 첫 문단 첫 run 에 있어야 한다, 표·사진의 자식 요소를 빠뜨리면 안 된다, 탭과 줄바꿈은
 * 글 요소 안에 넣는다). 고칠 때는 한글에서 다시 열어 본다.
 *
 * ponytail: 제목은 큰 글자일 뿐 한글의 개요 스타일이 아니다. 한글의 차례 만들기가 필요해지면 붙인다.
 * ponytail: 목록·인용 안의 표는 들여 쓰지 않고 본문 폭으로 넣는다.
 */
export function buildHwpx({ title, doc, images, origin }: ExportSource): Uint8Array {
  const chars = new Map<string, number>()
  const paras = new Map<string, number>()
  /** 번호 목록의 시작 번호. 목록마다 번호를 따로 센다. 1번은 개요 번호라 여기 것은 2번부터다. */
  const ordered: number[] = []
  const media: Record<string, Uint8Array> = {}
  const imageItems = new Map<string, string>()
  const manifest: string[] = []
  /** 문단·표·사진·링크에 주는 번호. 겹치지만 않으면 된다. 0번은 첫 문단이 쓴다. */
  let serial = 0

  const lookup = <T>(table: Map<string, number>, value: T) => {
    const key = JSON.stringify(value)
    const id = table.get(key) ?? table.size
    table.set(key, id)
    return id
  }
  const charId = (char: Partial<Char> = {}) => lookup(chars, { ...CHAR, ...char })
  const paraId = (para: Partial<Para> = {}) => lookup(paras, { ...PARA, ...para })
  // 0번은 "바탕글" 스타일이 가리키는 기본 모양이다. 본문보다 먼저 자리를 잡아 둔다.
  charId()
  paraId()

  /** 글자. 줄바꿈과 탭은 글 요소 안에 섞어 넣는다. 밖에 두면 한글이 버린다. */
  const text = (value: string) =>
    value
      // 복귀 글자(CR)는 XML 을 읽는 쪽이 줄바꿈 글자로 바꿔 글 안에 날것으로 남긴다. 줄바꿈으로 모은다.
      .replace(/\r\n?/g, '\n')
      .split(/(\n|\t)/)
      .map((part) =>
        part === '\n' ? '<hp:lineBreak/>' : part === '\t' ? '<hp:tab/>' : escapeXml(part),
      )
      .join('')
  const run = (inner: string, char: number) =>
    `<hp:run charPrIDRef="${char}"><hp:t>${inner}</hp:t></hp:run>`

  const charOf = (marks: JSONContent['marks'], ctx: Ctx, link: boolean): number => {
    const find = (type: string) => marks?.find((mark) => mark.type === type)
    const code = !!find('code')
    const highlight = find('highlight')
    return charId({
      height: ctx.size ?? CHAR.height,
      color: hexColor(find('textStyle')?.attrs?.color) ?? (link ? LINK : (ctx.color ?? CHAR.color)),
      shade: highlight ? (hexColor(highlight.attrs?.color) ?? 'FEF08A') : code ? FILL : null,
      bold: ctx.bold || !!find('bold'),
      italic: !!find('italic'),
      underline: link || !!find('underline'),
      strike: !!find('strike'),
      mono: code,
    })
  }

  /**
   * 링크. 시작 표시, 보이는 글, 끝 표시가 한 벌이다. 한글은 주소를 `Command` 에서 읽고,
   * 거기서는 `:` `?` `;` `#` 앞에 역슬래시를 붙여야 한다. 이름만 채우면 어디도 가리키지 않는다.
   */
  const hyperlink = (address: string, inner: string) => {
    // `|` 는 그 자리에서 "여기부터 풍선 도움말" 이고 역슬래시는 감싸는 글자다. 주소에 그대로 두면
    // 한글이 주소를 거기서 잘라 읽는다. 주소 표기(%7C·%5C)로 바꿔 싣는다.
    const href = address.replace(/[\\|]/g, encodeURIComponent)
    const id = ++serial
    const mail = href.startsWith('mailto:')
    // 메일 주소는 감싸지 않고 그대로 싣는다(한글이 쓰는 꼴이 그렇다).
    const command = mail ? `${href};2;0;0` : `${href.replace(/[:?;#]/g, '\\$&')};1;0;0;`
    const param = (name: string, value: string) =>
      `<hp:stringParam name="${name}">${escapeXml(value)}</hp:stringParam>`
    return (
      `<hp:run charPrIDRef="0"><hp:ctrl><hp:fieldBegin id="${id}" type="HYPERLINK" name="${escapeXml(href)}" editable="0" dirty="0" zorder="-1" fieldid="${LINK_FIELD}">` +
      `<hp:parameters cnt="6" name=""><hp:integerParam name="Prop">0</hp:integerParam>` +
      param('Command', command) +
      param('Path', href) +
      param('Category', mail ? 'HWPHYPERLINK_TYPE_EMAIL' : 'HWPHYPERLINK_TYPE_URL') +
      param('TargetType', 'HWPHYPERLINK_TARGET_BOOKMARK') +
      param('DocOpenType', 'HWPHYPERLINK_JUMP_CURRENTTAB') +
      `</hp:parameters></hp:fieldBegin></hp:ctrl></hp:run>` +
      inner +
      `<hp:run charPrIDRef="0"><hp:ctrl><hp:fieldEnd beginIDRef="${id}" fieldid="${LINK_FIELD}"/></hp:ctrl></hp:run>`
    )
  }

  const inlines = (node: JSONContent | undefined, ctx: Ctx): string =>
    (node?.content ?? [])
      .map((child) => {
        if (child.type === 'hardBreak') return run('<hp:lineBreak/>', charOf([], ctx, false))
        if (child.type === 'fileChip') {
          // 파일 자체는 담지 않는다. 이름을 남기고 서버의 그 파일로 링크를 건다.
          const label = text(`[첨부] ${cleanName(String(child.attrs?.name ?? ''))}`)
          const path = uploadedFilePath(child.attrs?.src)
          return path
            ? hyperlink(origin + path, run(label, charOf([], ctx, true)))
            : run(label, charOf([], ctx, false))
        }
        if (child.type !== 'text') return ''
        const href = safeHref(child.marks?.find((mark) => mark.type === 'link')?.attrs?.href)
        const body = run(text(child.text ?? ''), charOf(child.marks, ctx, !!href))
        return href ? hyperlink(href, body) : body
      })
      .join('')

  const para = (runs: string, ctx: Ctx, shape: Partial<Para> = {}, id = ++serial) => {
    const ref = paraId({
      left: ctx.indent,
      // 표 칸 안은 문단 사이를 붙인다.
      next: ctx.cell ? 0 : PARA.next,
      border: ctx.quote ? BORDER.quote : PARA.border,
      ...shape,
    })
    return (
      `<hp:p id="${id}" paraPrIDRef="${ref}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">` +
      (runs || `<hp:run charPrIDRef="0"><hp:t/></hp:run>`) +
      `</hp:p>`
    )
  }
  const align = (node: JSONContent | undefined) =>
    ALIGN.get(String(node?.attrs?.textAlign)) ?? 'LEFT'

  /**
   * 목록. 기호는 본문에 쓰지 않고 문단 모양이 가리키는 글머리표·번호 정의가 그린다.
   * 항목의 나머지 블록(이어지는 문단·안쪽 목록)은 한 단계 들여 쓴다.
   */
  const list = (node: JSONContent, ctx: Ctx, heading: string | null) =>
    (node.content ?? [])
      .map((item) => {
        const children = item.content ?? []
        const lead = children[0]?.type === 'paragraph' ? children[0] : undefined
        // 할 일 목록은 한글에 맞는 기호가 없어 상자를 글로 적는다.
        const box = heading ? '' : run(item.attrs?.checked ? '☑ ' : '☐ ', charId())
        return (
          para(box + inlines(lead, ctx), ctx, {
            align: align(lead),
            next: 200,
            ...(heading && { heading }),
          }) + blocks(lead ? children.slice(1) : children, { ...deeper(ctx), depth: ctx.depth + 1 })
        )
      })
      .join('')

  const table = (node: JSONContent) => {
    const { rows, columns } = layoutTable(node)
    // 위에서 내려온 합친 칸뿐인 행은 쓸 칸이 없다. 칸 없는 행은 한글이 거부하므로 행째 뺀다.
    const kept = rows.map((row) => row.some((cell) => cell.node))
    const rowCount = kept.filter(Boolean).length
    if (!columns.length || !rowCount) return ''
    // 문서에 적힌 열 너비는 px 이다. px 로 나눈 뒤 단위를 바꾼다.
    const grid = columnWidths(columns, PAGE_WIDTH / PX).map((px) => Math.floor(px * PX))
    const inner: Ctx = { indent: 0, depth: 0, quote: false, cell: true, bold: false }
    const margin = 'left="510" right="510" top="141" bottom="141"'
    /** 행 높이는 칸 위아래 여백만 적는다. 한글이 글에 맞춰 늘린다. */
    const ROW = 282

    const tc = (cell: JSONContent | null, col: number, row: number, colSpan = 1, rowSpan = 1) => {
      const header = cell?.type === 'tableHeader'
      return (
        `<hp:tc name="" header="0" hasMargin="0" protect="0" editable="0" dirty="0" borderFillIDRef="${header ? BORDER.headerCell : BORDER.cell}">` +
        `<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="TOP" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">` +
        // 빈 칸에도 문단 하나는 있어야 한다.
        (blocks(cell?.content, { ...inner, bold: header }) || para('', inner)) +
        `</hp:subList>` +
        `<hp:cellAddr colAddr="${col}" rowAddr="${row}"/><hp:cellSpan colSpan="${colSpan}" rowSpan="${rowSpan}"/>` +
        `<hp:cellSz width="${sum(grid.slice(col, col + colSpan))}" height="${ROW * rowSpan}"/>` +
        `<hp:cellMargin ${margin}/></hp:tc>`
      )
    }

    /**
     * 격자에서 이미 찬 자리. 워드와 달리 한글은 칸마다 주소를 적어서, 빈자리가 남거나 두 칸이 한 자리를
     * 덮으면 문서를 열지 못한다. 편집기는 표를 늘 네모로 맞춰 두지만 남의 편집으로 틀어진 표가 올 수 있다.
     */
    const taken = new Set<number>()
    const claim = (row: number, col: number, colSpan: number, rowSpan: number) => {
      const slots: number[] = []
      for (let r = row; r < row + rowSpan; r += 1) {
        for (let c = col; c < col + colSpan; c += 1) slots.push(r * columns.length + c)
      }
      if (slots.some((slot) => taken.has(slot))) return false
      slots.forEach((slot) => taken.add(slot))
      return true
    }

    let rowAddr = 0
    const body = rows
      .map((row, r) => {
        if (!kept[r]) return ''
        const addr = rowAddr
        rowAddr += 1
        const cells: [col: number, xml: string][] = []
        for (const { node: cell, col, colspan, rowspan } of row) {
          // 덮인 자리에는 칸을 만들지 않는다(워드와 다르다). 합친 칸이 제 넓이를 스스로 말한다.
          if (!cell || col >= columns.length) continue
          const colSpan = Math.min(colspan, columns.length - col)
          const rowSpan = kept.slice(r, r + rowspan).filter(Boolean).length
          // 합친 칸이 다른 칸과 겹치면 한 칸으로 줄이고, 그 자리마저 찼으면 버린다.
          if (claim(addr, col, colSpan, rowSpan))
            cells.push([col, tc(cell, col, addr, colSpan, rowSpan)])
          else if (claim(addr, col, 1, 1)) cells.push([col, tc(cell, col, addr)])
        }
        // 이 행에 남은 빈자리는 빈 칸으로 채운다.
        for (let col = 0; col < columns.length; col += 1) {
          if (claim(addr, col, 1, 1)) cells.push([col, tc(null, col, addr)])
        }
        cells.sort(([left], [right]) => left - right)
        return `<hp:tr>${cells.map(([, xml]) => xml).join('')}</hp:tr>`
      })
      .join('')

    // 글자처럼 취급하지 않는 표여야 쪽을 넘길 때 나뉜다. 글자처럼 취급하면 한글이 아래를 잘라 그린다.
    const tbl =
      `<hp:tbl id="${++serial}" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="CELL" repeatHeader="0" rowCnt="${rowCount}" colCnt="${columns.length}" cellSpacing="0" borderFillIDRef="${BORDER.cell}" noAdjust="0">` +
      `<hp:sz width="${sum(grid)}" widthRelTo="ABSOLUTE" height="${ROW * rowCount}" heightRelTo="ABSOLUTE" protect="0"/>` +
      `<hp:pos treatAsChar="0" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>` +
      `<hp:outMargin left="0" right="0" top="0" bottom="0"/><hp:inMargin ${margin}/>` +
      body +
      `</hp:tbl>`
    return para(`<hp:run charPrIDRef="0">${tbl}</hp:run>`, { ...inner, cell: false })
  }

  const picture = (node: JSONContent, ctx: Ctx) => {
    const src = String(node.attrs?.src ?? '')
    const image = images.get(src)
    const captionRuns = inlines(node, { ...ctx, size: 900, color: GRAY })
    const caption = captionRuns ? para(captionRuns, ctx) : ''
    if (!image || !image.width || !image.height) {
      const note = run('[사진을 불러오지 못했습니다]', charId({ italic: true, color: GRAY }))
      return para(note, ctx) + caption
    }

    let item = imageItems.get(src)
    if (!item) {
      item = `image${imageItems.size + 1}`
      const file = `BinData/${item}.${image.ext === 'jpeg' ? 'jpg' : image.ext}`
      media[file] = image.bytes
      // `isEmbeded` 는 한글의 철자다(d 하나). 없으면 한글이 사진을 버린다.
      manifest.push(
        `<opf:item id="${item}" href="${file}" media-type="image/${image.ext}" isEmbeded="1"/>`,
      )
      imageItems.set(src, item)
    }

    // 편집기에서 줄여 둔 폭을 따르되 본문 폭도 쪽 높이도 넘기지 않는다.
    const wanted = Number(node.attrs?.width) || image.width
    const w = Math.round(
      Math.max(
        PX,
        Math.min(
          (Number.isFinite(wanted) ? wanted : image.width) * PX,
          PAGE_WIDTH - ctx.indent,
          PAGE_HEIGHT * (image.width / image.height),
        ),
      ),
    )
    // 아주 납작하거나 아주 긴 사진에서 높이가 0 이 되거나 쪽을 넘지 않게 한 번 더 가둔다.
    const h = Math.min(PAGE_HEIGHT, Math.max(1, Math.round((w * image.height) / image.width)))
    const id = ++serial
    const matrix = 'e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"'
    // 자식 요소의 순서를 지킨다. 행렬 셋과 hc:img 는 빠지면 한글이 문서를 거부한다.
    const pic =
      `<hp:pic id="${id}" zOrder="0" numberingType="PICTURE" textWrap="SQUARE" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" href="" groupLevel="0" instid="${id}" reverse="0">` +
      `<hp:offset x="0" y="0"/><hp:orgSz width="${w}" height="${h}"/><hp:curSz width="${w}" height="${h}"/>` +
      `<hp:flip horizontal="0" vertical="0"/>` +
      `<hp:rotationInfo angle="0" centerX="${Math.floor(w / 2)}" centerY="${Math.floor(h / 2)}" rotateimage="1"/>` +
      `<hp:renderingInfo><hc:transMatrix ${matrix}/><hc:scaMatrix ${matrix}/><hc:rotMatrix ${matrix}/></hp:renderingInfo>` +
      `<hp:imgRect><hc:pt0 x="0" y="0"/><hc:pt1 x="${w}" y="0"/><hc:pt2 x="${w}" y="${h}"/><hc:pt3 x="0" y="${h}"/></hp:imgRect>` +
      `<hp:imgClip left="0" right="${w}" top="0" bottom="${h}"/><hp:inMargin left="0" right="0" top="0" bottom="0"/>` +
      `<hp:imgDim dimwidth="${w}" dimheight="${h}"/>` +
      `<hc:img binaryItemIDRef="${item}" bright="0" contrast="0" effect="REAL_PIC" alpha="0"/><hp:effects/>` +
      `<hp:sz width="${w}" widthRelTo="ABSOLUTE" height="${h}" heightRelTo="ABSOLUTE" protect="0"/>` +
      `<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>` +
      `<hp:outMargin left="0" right="0" top="0" bottom="0"/><hp:shapeComment/></hp:pic>`
    return para(`<hp:run charPrIDRef="0">${pic}</hp:run>`, ctx) + caption
  }

  const block = (node: JSONContent, ctx: Ctx): string => {
    switch (node.type) {
      case 'paragraph':
        return para(inlines(node, ctx), ctx, { align: align(node) })
      case 'heading': {
        const level = wholeNumber(node.attrs?.level, 1, 6)
        // 제목은 큰 굵은 글자다. 크기는 글자 모양에 실리므로 제목 안의 글자 서식도 같은 크기를 받는다.
        const size = [1600, 1300, 1100][level - 1] ?? CHAR.height
        return para(inlines(node, { ...ctx, bold: true, size }), ctx, {
          align: align(node),
          prev: level < 3 ? 1200 : 800,
        })
      }
      case 'bulletList':
        return list(node, ctx, `type="BULLET" idRef="1" level="${Math.min(ctx.depth, 6)}"`)
      case 'orderedList': {
        const id = ordered.push(wholeNumber(node.attrs?.start, 1, 32767)) + 1
        return list(node, ctx, `type="NUMBER" idRef="${id}" level="0"`)
      }
      case 'taskList':
        return list(node, ctx, null)
      case 'blockquote':
        return blocks(node.content, { ...deeper(ctx), quote: true })
      case 'codeBlock': {
        const code = (node.content ?? []).map((child) => child.text ?? '').join('')
        return para(run(text(code), charId({ mono: true, height: 900 })), ctx, {
          border: BORDER.code,
        })
      }
      case 'horizontalRule':
        return para('', ctx, { border: BORDER.rule })
      case 'table':
        return table(node)
      case 'imageBlock':
        return picture(node, ctx)
      default:
        // 모르는 블록은 버리지 않고 안의 블록을 꺼내 쓴다.
        return blocks(node.content, ctx)
    }
  }

  const blocks = (nodes: JSONContent[] | undefined, ctx: Ctx): string =>
    (nodes ?? []).map((node) => block(node, ctx)).join('')

  const root: Ctx = { indent: 0, depth: 0, quote: false, cell: false, bold: false }
  const section =
    `${XML}<hs:sec ${NS}>` +
    // 쪽 설정은 문서의 첫 문단 첫 run 에 든다. 제목 문단이 그 자리다.
    para(
      `<hp:run charPrIDRef="0">${SECTION_SETUP}</hp:run>` +
        run(text(title), charId({ height: 2000, bold: true })),
      root,
      { next: 1200 },
      0,
    ) +
    blocks(bodyBlocks(doc), root) +
    `</hs:sec>`

  const fonts = LANGS.map(
    (lang) =>
      `<hh:fontface lang="${lang.toUpperCase()}" fontCnt="2">` +
      ['맑은 고딕', '굴림체']
        .map(
          (face, id) =>
            `<hh:font id="${id}" face="${face}" type="TTF" isEmbedded="0"><hh:typeInfo familyType="FCAT_GOTHIC" weight="6" proportion="4" contrast="0" strokeVariation="1" armStyle="1" letterform="1" midline="1" xHeight="1"/></hh:font>`,
        )
        .join('') +
      `</hh:fontface>`,
  ).join('')
  const solid = { face: `#${FILL}`, hatch: '#FF000000' }
  const borderFills = [
    borderFill(1, [], '0.1 mm', '000000'),
    borderFill(2, [], '0.1 mm', '000000', { face: 'none', hatch: '#999999' }),
    borderFill(BORDER.cell, ['left', 'right', 'top', 'bottom'], '0.12 mm', LINE),
    borderFill(BORDER.headerCell, ['left', 'right', 'top', 'bottom'], '0.12 mm', LINE, solid),
    borderFill(BORDER.quote, ['left'], '0.7 mm', LINE),
    borderFill(BORDER.rule, ['bottom'], '0.12 mm', LINE),
    borderFill(BORDER.code, [], '0.1 mm', '000000', solid),
  ]
  const listOf = <T>(tag: string, items: T[], render: (item: T, id: number) => string) =>
    `<hh:${tag} itemCnt="${items.length}">${items.map(render).join('')}</hh:${tag}>`

  const header =
    `${XML}<hh:head ${NS} version="1.5" secCnt="1">` +
    `<hh:beginNum page="1" footnote="1" endnote="1" pic="1" tbl="1" equation="1"/><hh:refList>` +
    `<hh:fontfaces itemCnt="${LANGS.length}">${fonts}</hh:fontfaces>` +
    listOf('borderFills', borderFills, (xml) => xml) +
    listOf('charProperties', [...chars.keys()], (key, id) => charPr(id, JSON.parse(key) as Char)) +
    `<hh:tabProperties itemCnt="3"><hh:tabPr id="0" autoTabLeft="0" autoTabRight="0"/><hh:tabPr id="1" autoTabLeft="1" autoTabRight="0"/><hh:tabPr id="2" autoTabLeft="0" autoTabRight="1"/></hh:tabProperties>` +
    `<hh:numberings itemCnt="${ordered.length + 1}">${OUTLINE}` +
    ordered
      .map(
        (start, i) =>
          `<hh:numbering id="${i + 2}" start="${start}">${paraHead(1, start, 'DIGIT', '^1.')}</hh:numbering>`,
      )
      .join('') +
    `</hh:numberings>` +
    // 글머리표 모양은 하나만 둔다. 편집기도 깊이마다 같은 점을 쓴다. 깊이는 문단 쪽 level 이 말한다.
    `<hh:bullets itemCnt="1"><hh:bullet id="1" char="•" useImage="0"><hh:paraHead level="0" align="LEFT" useInstWidth="0" autoIndent="1" widthAdjust="0" textOffsetType="PERCENT" textOffset="50" numFormat="DIGIT" charPrIDRef="4294967295" checkable="0"/></hh:bullet></hh:bullets>` +
    listOf('paraProperties', [...paras.keys()], (key, id) => paraPr(id, JSON.parse(key) as Para)) +
    `<hh:styles itemCnt="1"><hh:style id="0" type="PARA" name="바탕글" engName="Normal" paraPrIDRef="0" charPrIDRef="0" nextStyleIDRef="0" langID="1042" lockForm="0"/></hh:styles>` +
    `</hh:refList>` +
    // 아래 넷의 철자(trackchageConfig)와 순서는 한글이 쓰는 그대로다.
    `<hh:compatibleDocument targetProgram="HWP201X"><hh:layoutCompatibility/></hh:compatibleDocument>` +
    `<hh:docOption><hh:linkinfo path="" pageInherit="0" footnoteInherit="0"/></hh:docOption>` +
    `<hh:metaTag>{"name":""}</hh:metaTag><hh:trackchageConfig flags="56"/></hh:head>`

  const meta = (name: string, value = '') =>
    `<opf:meta name="${name}" content="text">${escapeXml(value)}</opf:meta>`
  const part = (name: string) => `rdf:resource="Contents/${name}.xml"`
  const PKG = `${HWPML}/2016/meta/pkg#`
  const files: Zippable = {
    // mimetype 은 첫 항목이고 압축하지 않는다. zip 을 풀지 않고도 형식을 알아보게 하는 약속이다.
    mimetype: [strToU8('application/hwp+zip'), { level: 0 }],
    // `tagetApplication` 은 한글의 철자다. 고치면 한글이 문서를 거부한다.
    'version.xml': strToU8(
      `${XML}<hv:HCFVersion xmlns:hv="${HWPML}/2011/version" tagetApplication="WORDPROCESSOR" major="5" minor="1" micro="1" buildNumber="0" os="1" xmlVersion="1.5" application="Hancom Office Hangul" appVersion="13, 0, 0, 1408 WIN32LEWindows_10"/>`,
    ),
    'Contents/header.xml': strToU8(header),
    'Contents/section0.xml': strToU8(section),
    'Preview/PrvText.txt': strToU8(`${title}\r\n`),
    'settings.xml': strToU8(
      `${XML}<ha:HWPApplicationSetting xmlns:ha="${HWPML}/2011/app" xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0"><ha:CaretPosition listIDRef="0" paraIDRef="0" pos="0"/></ha:HWPApplicationSetting>`,
    ),
    'META-INF/container.rdf': strToU8(
      `${XML}<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">` +
        `<rdf:Description rdf:about=""><ns0:hasPart xmlns:ns0="${PKG}" ${part('header')}/></rdf:Description>` +
        `<rdf:Description rdf:about="Contents/header.xml"><rdf:type rdf:resource="${PKG}HeaderFile"/></rdf:Description>` +
        `<rdf:Description rdf:about=""><ns0:hasPart xmlns:ns0="${PKG}" ${part('section0')}/></rdf:Description>` +
        `<rdf:Description rdf:about="Contents/section0.xml"><rdf:type rdf:resource="${PKG}SectionFile"/></rdf:Description>` +
        `<rdf:Description rdf:about=""><rdf:type rdf:resource="${PKG}Document"/></rdf:Description></rdf:RDF>`,
    ),
    'Contents/content.hpf': strToU8(
      `${XML}<opf:package ${NS} version="" unique-identifier="" id="">` +
        `<opf:metadata><opf:title>${escapeXml(title)}</opf:title><opf:language>ko</opf:language>` +
        meta('creator', 'Zenith') +
        meta('subject') +
        meta('description') +
        meta('lastsaveby', 'Zenith') +
        meta('keyword') +
        `</opf:metadata><opf:manifest>` +
        `<opf:item id="header" href="Contents/header.xml" media-type="application/xml"/>` +
        `<opf:item id="section0" href="Contents/section0.xml" media-type="application/xml"/>` +
        `<opf:item id="settings" href="settings.xml" media-type="application/xml"/>` +
        manifest.join('') +
        `</opf:manifest><opf:spine><opf:itemref idref="header" linear="yes"/><opf:itemref idref="section0" linear="yes"/></opf:spine></opf:package>`,
    ),
    'META-INF/container.xml': strToU8(
      `${XML}<ocf:container xmlns:ocf="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf"><ocf:rootfiles>` +
        `<ocf:rootfile full-path="Contents/content.hpf" media-type="application/hwpml-package+xml"/>` +
        `<ocf:rootfile full-path="Preview/PrvText.txt" media-type="text/plain"/>` +
        `<ocf:rootfile full-path="META-INF/container.rdf" media-type="application/rdf+xml"/>` +
        `</ocf:rootfiles></ocf:container>`,
    ),
    'META-INF/manifest.xml': strToU8(
      `${XML}<odf:manifest xmlns:odf="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"/>`,
    ),
    ...media,
  }
  return zipSync(files, { level: 6 })
}
