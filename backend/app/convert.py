"""파일 → 문서 본문 HTML(README 60) — docx·xlsx·hwpx 를 편집기(Tiptap)가 읽는 HTML 로 바꾼다.

프론트는 이 HTML 을 AI 「문서로 저장」과 같은 길(`DocSeedState.seedHtml` → `editor.commands.setContent`)로 새
문서에 심는다. 서버가 Y.Doc 을 직접 만들지 않는 이유: 편집기 스키마와 한 글자라도 어긋난 노드는 Tiptap 이 통째로
버리는데, HTML 은 Tiptap 파서가 구조를 맞춰 준다. 그래서 태그는 ALLOWED 로 좁히고 속성은 colspan·rowspan·
href(http·https·mailto)만 남긴다. 원본 HTML 이 그대로 통과하는 경로는 없다 — docx 는 mammoth 가 만든 HTML 을
한 번 더 거르고, xlsx·hwpx 는 여기서 escape 해 만든 뒤 같은 필터를 지난다.

상한: 올리는 파일은 10MB(라우터)지만 압축을 풀면 훨씬 클 수 있어 본문 XML 은 MAX_XML_BYTES 에서 거절하고(mammoth 는
31KB zip 안의 30만 문단에 20초·660MB 를 썼다, 리뷰), zip 항목·총량·셀 수는 ai/extract.py 의 것을 그대로 쓴다. 결과는
심을 때 **Yjs 업데이트 하나**가 되어 소켓 프레임 상한(realtime/yjs.py MAX_FRAME 1MB)을 넘으면 서버가 연결을 닫고
본문이 통째로 사라지므로, 글자 바이트 + 요소마다 TAG_COST 로 업데이트 크기를 어림해 MAX_SEED_COST 에서 행·항목·블록
경계로 끊는다(빈 셀 하나가 Yjs 로는 130 바이트다). CPU 작업이라 호출자는 스레드로 돌린다(`asyncio.to_thread`).
"""

import html
import io
import re
import xml.etree.ElementTree as ET
import zipfile
from html.parser import HTMLParser

import mammoth
import openpyxl

from app.ai.extract import _HP, MAX_XLSX_CELLS, Empty, Unsupported, _zip, hwpx_sections

SUPPORTED = ("docx", "xlsx", "hwpx")
TIMEOUT_S = 60.0  # 변환 한 건 상한 — 스레드는 못 끊지만 요청은 422 로 돌려준다(ai.py ATTACH_EXTRACT_TIMEOUT_S 와 같다)
MAX_XML_BYTES = (
    2 * 1024 * 1024
)  # 본문 XML(document.xml·section*.xml 합) 압축 해제 상한 — 한글 70만 자, 결과 상한의 몇 배
MAX_SEED_COST = 500_000  # Yjs 업데이트 어림 바이트 — MAX_FRAME(1MB)의 절반
TAG_COST = 64  # 요소 하나의 Yjs 몫 어림(실측: tableCell+paragraph+글자 1 = 130 바이트)
TRUNCATED_NOTE = "<p><em>(파일이 길어 여기서 끊었습니다. 나머지는 원본 파일을 여세요.)</em></p>"

# 편집기 확장(frontend editorExtensions.ts: StarterKit·Table·Link·Underline)이 읽는 태그만. 그 밖은 태그만 벗기고 글자는 남긴다.
_BLOCK = frozenset(
    "p h1 h2 h3 h4 h5 h6 ul ol li table thead tbody tr th td pre blockquote hr".split()
)
_INLINE = frozenset("strong em u s a br code".split())
ALLOWED = _BLOCK | _INLINE
_VOID = frozenset({"br", "hr"})
_DROP = frozenset({"script", "style", "head"})  # 글자까지 버린다
_HREF_OK = re.compile(r"^(https?://|mailto:)", re.IGNORECASE)
MAX_SPAN = (
    63  # colspan·rowspan 상한 — 999 하나로 prosemirror-tables 가 빈칸 수천만 개를 채우려 든다(리뷰)
)

MAX_HREF = 2000  # 더 긴 주소는 링크를 벗긴다 — 속성 바이트도 비용에 넣지만 주소 하나가 예산을 먹지 않게(리뷰)
# xlsx dimension 어림 상한 — read_only 는 선언된 범위만큼 빈 행도 돌려준다(`A1:XFD1048576` 하나로 160억 칸, 리뷰).
# LibreOffice 가 흔히 쓰는 `A1:AMJ…`(1024열)·2만 행은 통과한다.
MAX_XLSX_AREA = 20_000_000
MAX_XLSX_VISITED = (
    2_000_000  # 빈 칸 포함 실제로 돈 칸 수 — 넘으면 끊는다(선언이 작아도 빈 행이 길 때)
)


class TooLarge(ValueError):
    """본문 XML 이 MAX_XML_BYTES 를 넘는다 — 형식은 맞지만 받지 않는다."""


def to_html(name: str, data: bytes) -> tuple[str, bool]:
    """(HTML, 끊었는가). 확장자로 가르고 zip 서명·상한은 `_zip` 이 본다. 파서가 내는 어떤 예외든 `Unsupported` 로
    — 깨진 파일이 500 이 되지 않게(extract.extract 와 같은 규칙). 글자가 하나도 없으면 `Empty`."""
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    if ext not in SUPPORTED:
        raise Unsupported(ext)
    try:
        if ext == "docx":
            raw, cut = _docx(data)
        elif ext == "xlsx":
            raw, cut = _xlsx(data)
        else:
            raw, cut = _hwpx(_zip(data))
    except (Unsupported, Empty, TooLarge):
        raise
    except Exception as e:  # noqa: BLE001 — ET.ParseError·KeyError(zip 항목 없음)·zlib.error… 전부 형식 오류
        raise Unsupported(ext) from e
    f = _Filter()
    f.feed(raw)
    f.close()
    if f.chars == 0:
        raise Empty(ext)
    body, truncated = f.result()
    if cut and not truncated:
        body += TRUNCATED_NOTE  # 형식 단계(셀 상한)에서 끊겼지만 결과는 작다 — 안내는 붙인다
    return body, truncated or cut


# ── 필터 ─────────────────────────────────────────────────────────────────────────


class _Filter(HTMLParser):
    """허용 태그·속성만 다시 써서 HTML 을 만든다. 열린 태그 스택을 들고 있어 끝에 닫히지 않은 태그를 닫고,
    행(tr)·항목(li)·최상위 블록이 끝나는 자리를 기억해 두었다가 어림 비용이 MAX_SEED_COST 를 넘으면 그 자리에서 끊는다."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.out: list[str] = []
        self.cost = 0  # 글자 바이트 + 요소마다 TAG_COST
        self.stack: list[str] = []
        self.chars = 0  # 공백이 아닌 글자 수 — 0 이면 Empty
        self.cuts: list[tuple[int, int, list[str]]] = []  # (out 길이, 그때 비용, 열린 태그)
        self.drop = 0  # _DROP 안 깊이
        self.implicit_p = False  # 블록 밖 글자를 감싸려고 우리가 연 <p>

    def _emit(self, s: str, cost: int = 0) -> None:
        self.out.append(s)
        self.cost += cost

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in _DROP:
            self.drop += 1
            return
        if self.drop or tag not in ALLOWED:
            return
        if self.implicit_p and tag in _BLOCK:
            self.handle_endtag("p")
        if not self.stack and tag in _INLINE and tag not in _VOID:
            self._open_implicit_p()  # 블록 밖 링크·굵게 — 글자와 같은 규칙으로 문단에 넣는다
        kept: dict[str, str] = {}  # 같은 속성이 두 번 오면 마지막 것 — 하나만 남긴다
        for key, value in attrs:
            if value is None:
                continue
            value = value.strip()
            if (
                tag == "a" and key == "href" and len(value) <= MAX_HREF and _HREF_OK.match(value)
            ) or (
                tag in ("td", "th")
                and key in ("colspan", "rowspan")
                and value.isdigit()
                and 1 <= int(value) <= MAX_SPAN
            ):
                kept[key] = value
        if tag == "a" and not kept:
            return  # 주소가 없거나 javascript: 같은 것 — 링크를 벗기고 글자만 남긴다
        attr_html = "".join(f' {k}="{html.escape(v, quote=True)}"' for k, v in kept.items())
        self._emit(f"<{tag}{attr_html}>", TAG_COST + len(attr_html.encode()))
        if tag not in _VOID:
            self.stack.append(tag)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        depth = len(self.stack)
        self.handle_starttag(tag, attrs)
        if len(self.stack) > depth:  # 실제로 연 것만 닫는다 — `<a/>` 가 바깥 링크를 닫지 않게(리뷰)
            self.handle_endtag(tag)

    def handle_endtag(self, tag: str) -> None:
        if tag in _DROP:
            self.drop = max(0, self.drop - 1)
            return
        if self.drop or tag not in self.stack:
            return
        while self.stack:  # 어긋나게 닫힌 안쪽 태그도 같이 닫는다
            top = self.stack.pop()
            self._emit(f"</{top}>")
            if top == "p":
                self.implicit_p = False
            if top == tag:
                break
        if tag in ("tr", "li") or not self.stack:
            self.cuts.append((len(self.out), self.cost, list(self.stack)))

    def handle_data(self, data: str) -> None:
        if self.drop:
            return
        if not self.stack:
            if not data.strip():
                return
            self._open_implicit_p()
        self.chars += len(data.strip())
        self._emit(html.escape(data, quote=False), len(data.encode()))

    def _open_implicit_p(self) -> None:
        # 블록 밖 글자 — Tiptap 은 어차피 문단으로 감싼다. 끊는 자리 계산을 위해 명시
        self._emit("<p>", TAG_COST)
        self.stack.append("p")
        self.implicit_p = True

    def close(self) -> None:
        super().close()
        while self.stack:
            self._emit(f"</{self.stack.pop()}>")
        self.cuts.append((len(self.out), self.cost, []))

    def result(self) -> tuple[str, bool]:
        if self.cost <= MAX_SEED_COST:
            return "".join(self.out), False
        budget = MAX_SEED_COST - 2 * TAG_COST - len(TRUNCATED_NOTE.encode())
        for n, cost, open_tags in reversed(self.cuts):
            if cost <= budget:
                closers = "".join(f"</{t}>" for t in reversed(open_tags))
                return "".join(self.out[:n]) + closers + TRUNCATED_NOTE, True
        return TRUNCATED_NOTE, True  # 첫 행·블록 하나가 상한보다 크다 — 원본 파일만 남긴다


# ── 형식별 ──────────────────────────────────────────────────────────────────────


def _docx(data: bytes) -> tuple[str, bool]:
    """mammoth — 제목(heading n)·목록(numbering)·표·굵게·기울임·밑줄·취소선·링크를 HTML 로. 그림은 비운다(필터가
    img 를 버리고, 읽지도 않게). zip 항목·총량 상한은 먼저 `_zip` 으로 보고, 본문 XML 크기는 MAX_XML_BYTES 로 — mammoth 는
    문단 수에 비례해 느리고 무겁다(31KB zip·30만 문단 = 20초·660MB, 리뷰)."""
    with _zip(data) as z:
        if "word/document.xml" not in z.namelist():
            raise Unsupported("docx")
        if z.getinfo("word/document.xml").file_size > MAX_XML_BYTES:
            raise TooLarge("docx")
    result = mammoth.convert_to_html(
        io.BytesIO(data),
        style_map="u => u",  # 기본 매핑은 밑줄을 버린다
        convert_image=mammoth.images.img_element(lambda _image: {}),
    )
    return result.value, False


def _xlsx(data: bytes) -> tuple[str, bool]:
    """시트마다 「h2 시트명」 + 표. 첫 행은 머리글(th). 빈 행은 건너뛰고 뒤쪽 빈 칸은 잘라 표가 넓어지지 않게(셀 수도
    자른 뒤로 센다 — read_only 는 dimension 이 `A1:AMJ…` 인 파일에서 행마다 1024칸을 돌려준다, 리뷰). 셀 수(MAX_XLSX_CELLS)
    나 결과 크기에서 멈추면 끊었다고 돌려준다.
    ponytail: 병합 셀은 풀어진 채(첫 칸에만 값), 날짜는 str() 그대로. 서식이 필요해지면 ws.merged_cells 와 number_format.
    """
    _zip(data).close()
    wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    parts: list[str] = []
    cells = visited = size = 0
    try:
        if any((ws.max_row or 0) * (ws.max_column or 0) > MAX_XLSX_AREA for ws in wb.worksheets):
            raise TooLarge("xlsx")  # 선언된 범위(dimension) 기준 — 돌기 전에 거절
        for ws in wb.worksheets:
            parts.append(f"<h2>{html.escape(ws.title)}</h2><table>")
            header = True
            for row in ws.iter_rows(values_only=True):
                visited += len(row)
                n = len(row)
                while n and row[n - 1] is None:  # 뒤쪽 빈 칸 — 역방향으로 한 번만 자른다
                    n -= 1
                row = row[:n]
                if visited > MAX_XLSX_VISITED:
                    parts.append("</table>")
                    return "".join(parts), True
                if not row:
                    continue
                cells += len(row)
                if cells > MAX_XLSX_CELLS or size > 2 * MAX_SEED_COST:
                    parts.append("</table>")
                    return "".join(parts), True
                tag = "th" if header else "td"
                header = False
                line = "".join(
                    f"<{tag}><p>{html.escape('' if v is None else str(v))}</p></{tag}>" for v in row
                )
                parts.append(f"<tr>{line}</tr>")
                size += len(line) + len(row) * 2 * TAG_COST
            parts.append("</table>")
    finally:
        wb.close()
    return "".join(parts), False


def _hwpx(z: zipfile.ZipFile) -> tuple[str, bool]:
    """섹션 순서대로 최상위 문단(hs:sec 의 직속 hp:p). 문단 글자는 run 의 hp:t(tab·lineBreak 포함), 문단 안 표는
    hp:tbl/hp:tr/hp:tc/hp:subList/hp:p 를 같은 규칙으로(셀 안 표도). 셀 병합은 hp:cellSpan.
    ponytail: 제목·굵게는 header.xml 의 스타일 표를 봐야 알 수 있어 1차에선 전부 문단. 필요해지면 paraPr/charPr 대조."""
    sections = hwpx_sections(z)
    if sum(z.getinfo(s).file_size for s in sections) > MAX_XML_BYTES:
        raise TooLarge("hwpx")
    parts: list[str] = []
    for sec in sections:
        root = ET.fromstring(z.read(sec))
        for p in root.findall(f"{_HP}p"):
            parts.append(_hp_block(p))
    return "".join(parts), False


def _hp_block(p) -> str:
    """run 순서대로 — 「글 → 표 → 글」이 「글글 → 표」가 되지 않게(리뷰). 표 앞뒤 글은 각각 문단."""
    out: list[str] = []
    text: list[str] = []

    def flush() -> None:
        if line := "".join(text).strip():
            out.append(f"<p>{line}</p>")
        text.clear()

    for run in p.findall(f"{_HP}run"):
        for el in run:
            tag = el.tag.removeprefix(_HP)
            if tag == "t":
                text.append(_hp_text(el))
            elif tag == "tbl":
                flush()
                out.append(_hp_table(el))
    flush()
    return "".join(out)


def _hp_text(t) -> str:
    parts = [html.escape(t.text or "", quote=False)]
    for child in t:
        tag = child.tag.removeprefix(_HP)
        parts.append("	" if tag == "tab" else "<br>" if tag == "lineBreak" else "")
        parts.append(html.escape(child.tail or "", quote=False))
    return "".join(parts)


def _hp_table(tbl) -> str:
    rows: list[str] = []
    for tr in tbl.findall(f"{_HP}tr"):
        cells: list[str] = []
        for tc in tr.findall(f"{_HP}tc"):
            inner = "".join(_hp_block(p) for p in tc.findall(f"{_HP}subList/{_HP}p")) or "<p></p>"
            span = tc.find(f"{_HP}cellSpan")
            attrs = ""
            if span is not None:
                for src, dst in (("colSpan", "colspan"), ("rowSpan", "rowspan")):
                    if (v := span.get(src, "1")) != "1":
                        attrs += f' {dst}="{html.escape(v, quote=True)}"'  # 상한은 필터가 본다
            cells.append(f"<td{attrs}>{inner}</td>")
        rows.append(f"<tr>{''.join(cells)}</tr>")
    return f"<table>{''.join(rows)}</table>"
