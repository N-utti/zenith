import { strToU8, zipSync } from 'fflate'

export type XlsxCell = string | number

export interface XlsxOptions {
  /** 시트 이름(31자 이내, `[]:*?/\` 금지). */
  sheet?: string
  /** 왼쪽에서 이 열 수까지 가로 스크롤에 고정. 첫 행(머리글)은 항상 고정. */
  freezeCols?: number
  /** 천 단위 쉼표(`#,##0`)로 보일 숫자 열. 없으면 일반 서식이라 12자리부터 `1.2E+11` 로 보인다. */
  integerCols?: number[]
}

/**
 * 표 하나짜리 xlsx 를 만든다. 열 너비는 열마다 가장 긴 값에 맞추고, 머리글은 굵게.
 * xlsx 는 XML 몇 장을 zip 으로 묶은 것이라 라이브러리 없이 손으로 쓴다(fflate 는 zip 만).
 * 셀은 전부 inlineStr(문자열) 또는 n(숫자). 수식·날짜 형식·병합은 없다.
 *
 * ponytail: 시트 여러 장, 셀 서식, 수식이 필요해지면 그때 exceljs 로 간다.
 * ponytail: 열 너비의 Math.max(...rows) 는 수만 행에서 인수 한계에 걸린다. 15명 × 31일 표라 무관.
 */
export function buildXlsx(rows: XlsxCell[][], options: XlsxOptions = {}): Uint8Array {
  // 엑셀 시트 이름 제약: 31자, `[]:*?/\` 금지. 어기면 파일을 조용히 거부한다.
  const sheet = (options.sheet ?? 'Sheet1').replace(/[[\]:*?/\\]/g, '_').slice(0, 31) || 'Sheet1'
  const freezeCols = options.freezeCols ?? 0
  const integerCols = new Set(options.integerCols)
  // 쉼표가 붙은 모양으로 폭을 잰다. 안 그러면 열이 좁아 `####` 로 보인다.
  const shown = (value: XlsxCell, c: number) =>
    typeof value === 'number' && integerCols.has(c) ? value.toLocaleString('en-US') : value
  const width = Math.max(0, ...rows.map((r) => r.length))

  const cols = Array.from({ length: width }, (_, c) => {
    const longest = Math.max(...rows.map((r) => displayWidth(shown(r[c] ?? '', c))))
    // 엑셀 열 너비 단위는 대략 반각 글자 수. 여백 2 를 더하고 60 에서 자른다.
    return `<col min="${c + 1}" max="${c + 1}" width="${Math.min(60, longest + 2)}" customWidth="1"/>`
  }).join('')

  const sheetData = rows
    .map((row, r) => {
      const cells = row
        .map((value, c) => {
          const ref = `${colName(c)}${r + 1}`
          const style = r === 0 ? ' s="1"' : integerCols.has(c) ? ' s="2"' : ''
          // NaN·Infinity 는 <v> 에 못 들어간다. 숫자가 아닌 것은 전부 문자열로.
          return typeof value === 'number' && Number.isFinite(value)
            ? `<c r="${ref}"${style}><v>${value}</v></c>`
            : `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${escapeXml(String(value ?? ''))}</t></is></c>`
        })
        .join('')
      return `<row r="${r + 1}">${cells}</row>`
    })
    .join('')

  const pane = `<pane xSplit="${freezeCols}" ySplit="1" topLeftCell="${colName(freezeCols)}2" activePane="bottomRight" state="frozen"/>`

  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
        `</Types>`,
    ),
    '_rels/.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
        `</Relationships>`,
    ),
    'xl/workbook.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        `<sheets><sheet name="${escapeXml(sheet)}" sheetId="1" r:id="rId1"/></sheets>` +
        `</workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
        `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        `</Relationships>`,
    ),
    // 글꼴 둘(보통·굵게), 셀 서식 셋(0 보통, 1 머리글, 2 천 단위 쉼표: 내장 서식 3번). 엑셀은 이 최소 골격이 없으면 파일을 안 연다.
    'xl/styles.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
        `<fonts count="2"><font><sz val="11"/><name val="맑은 고딕"/></font><font><b/><sz val="11"/><name val="맑은 고딕"/></font></fonts>` +
        `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
        `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
        `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
        `<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>` +
        `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
        `</styleSheet>`,
    ),
    'xl/worksheets/sheet1.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
        `<sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews>` +
        (cols ? `<cols>${cols}</cols>` : '') +
        `<sheetData>${sheetData}</sheetData>` +
        `</worksheet>`,
    ),
  }
  return zipSync(files, { level: 6 })
}

/** 0 → A, 25 → Z, 26 → AA */
export function colName(index: number): string {
  let n = index + 1
  let name = ''
  while (n > 0) {
    const r = (n - 1) % 26
    name = String.fromCharCode(65 + r) + name
    n = Math.floor((n - 1) / 26)
  }
  return name
}

/** 한글·한자 같은 전각은 반각 두 칸으로 센다. 열 너비를 글자 수로 맞출 때. */
export function displayWidth(value: XlsxCell): number {
  let w = 0
  for (const ch of String(value))
    w += /[\u1100-\u11ff\u3000-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/.test(ch) ? 2 : 1
  return w
}

/** XML 글자·속성값으로 안전하게. 문서 내보내기(docx)도 같이 쓴다. */
export function escapeXml(text: string): string {
  return (
    text
      // XML 1.0 이 금지하는 제어문자(탭·개행·복귀 제외)와 비문자 둘(U+FFFE·U+FFFF). 이스케이프도 안 되니 지운다.
      // eslint-disable-next-line no-control-regex -- 제어문자 제거가 목적이다
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  )
}
