"""AI 파일 수정(README 53, 두 번째 계획 D2) — xlsx·docx 를 **편집 연산**으로만 고친다.

모델에게는 파일을 번호 붙인 평면 보기(`dump_*`)로 보여 주고, 모델은 바꿀 곳만 JSON 연산으로 돌려준다. 서버가 원본에
연산을 적용해(`apply_*`) 새 파일을 만든다 — 서식·수식·나머지 셀과 문단은 손대지 않는다. 무엇이 바뀌었는지는
`Change` 목록으로 돌려줘 사용자가 적용 전에 본다. 통째로 다시 쓰게 하지 않는 이유: 서식이 날아가고 바뀐 곳을 설명할 수 없다.
"""

import io
import math
import re
import xml.etree.ElementTree as ET
import zipfile
from dataclasses import dataclass

import openpyxl

MAX_VIEW_CELLS = (
    3000  # 모델에게 보여 주는 셀 수 상한 — 그 뒤는 「(…)」 로 표시하고 수정 대상에서 뺀다
)
MAX_OPS = 200
_W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
_CELL_RE = re.compile(r"^[A-Z]{1,3}[1-9]\d{0,6}$")
EDITABLE = ("xlsx", "docx")
# 문단 안에 이것들이 있으면 「글자만 바꾸기」가 내용을 틀리게 만든다(링크·변경 추적·필드·그림·글상자) — 읽기 전용으로 보여 주고
# 고치려 하면 BadOp(리뷰). 글상자 안 문단은 바깥 문단의 글에 넣지 않는다.
_COMPLEX = {
    f"{_W}hyperlink",
    f"{_W}ins",
    f"{_W}del",
    f"{_W}sdt",
    f"{_W}smartTag",
    f"{_W}fldSimple",
    f"{_W}fldChar",
    f"{_W}instrText",
    f"{_W}drawing",
    f"{_W}pict",
    f"{_W}txbxContent",
    f"{_W}object",
}
_XLSX_UNSUPPORTED = (
    "xl/charts/",
    "xl/drawings/",
    "xl/media/",
)  # openpyxl 이 저장할 때 버린다 — 고치지 않는다


class BadOp(ValueError):
    """모델이 낸 연산이 파일과 맞지 않는다(없는 시트·셀 모양·문단 번호)."""


@dataclass
class Change:
    where: str  # 「매출!B7」 또는 「문단 12」
    before: str
    after: str


# ── xlsx ───────────────────────────────────────────────────────────────────────


def has_unsupported_parts(data: bytes) -> bool:
    """차트·도형·그림이 있는 xlsx — openpyxl 이 저장하면 사라지므로 고치지 않는다(리뷰)."""
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        return any(n.startswith(_XLSX_UNSUPPORTED) for n in z.namelist())


def dump_xlsx(data: bytes) -> str:
    """`시트!A1 = 값` 한 줄씩(수식은 식 그대로). 비어 있지 않은 셀만, MAX_VIEW_CELLS 까지."""
    wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True)
    lines: list[str] = []
    n = 0
    try:
        for ws in wb.worksheets:
            lines.append(f"## {ws.title}")
            for row in ws.iter_rows():
                for c in row:
                    if c.value is None:
                        continue
                    n += 1
                    if n > MAX_VIEW_CELLS:
                        lines.append("(셀이 많아 여기까지만 보인다 — 이 뒤는 수정할 수 없다)")
                        return "\n".join(lines)
                    lines.append(
                        f"{ws.title}!{c.coordinate} = {str(c.value).replace(chr(10), '⏎')}"
                    )  # 셀 안 줄바꿈이 가짜 줄이 되지 않게
    finally:
        wb.close()
    return "\n".join(lines)


def apply_xlsx(data: bytes, ops: list[dict]) -> tuple[bytes, list[Change]]:
    """ops: [{"sheet": "매출", "cell": "B7", "value": 1250}]. 값은 문자열·숫자·불리언·null(지우기). 수식은 문자열 `=…`."""
    wb = openpyxl.load_workbook(io.BytesIO(data))  # 서식·수식 보존(읽기 전용 아님)
    changes: list[Change] = []
    try:
        for op in ops[:MAX_OPS]:
            sheet, cell = str(op.get("sheet", "")), str(op.get("cell", "")).upper()
            if sheet not in wb.sheetnames:
                raise BadOp(f"없는 시트: {sheet}")
            if not _CELL_RE.match(cell):
                raise BadOp(f"셀 주소가 아니다: {cell}")
            value = op.get("value")
            if not isinstance(value, str | int | float | bool | type(None)):
                raise BadOp(f"값 종류가 아니다: {type(value).__name__}")
            if isinstance(value, float) and not math.isfinite(value):
                raise BadOp("무한대·NaN 은 넣을 수 없다")
            if isinstance(value, str):
                value = _XML_ILLEGAL_RE.sub("", value)
            try:
                ws = wb[sheet]
                before = ws[cell].value
                ws[cell] = value
            except Exception as e:  # noqa: BLE001 — 차트 시트·범위 밖 행·금지 문자 등 openpyxl 의 여러 예외
                raise BadOp(f"{sheet}!{cell} 에 넣을 수 없다: {e}") from e
            changes.append(Change(where=f"{sheet}!{cell}", before=_s(before), after=_s(value)))
        out = io.BytesIO()
        wb.save(out)
        return out.getvalue(), changes
    finally:
        wb.close()


def _s(v: object) -> str:
    return "" if v is None else str(v)


# ── docx ───────────────────────────────────────────────────────────────────────


def _paragraphs(body) -> list:
    return list(body.iter(f"{_W}p"))  # 본문 순서(표 셀 문단·콘텐츠 컨트롤 안 문단 포함)


def _ptext(p) -> str:
    """문단 글 — 중첩 문단(글상자 w:txbxContent 안)은 제 문단으로 따로 세므로 여기선 뺀다."""
    out: list[str] = []

    def walk(node) -> None:
        for el in node:
            if el.tag == f"{_W}txbxContent":
                continue
            if el.tag == f"{_W}t":
                out.append(el.text or "")
            elif el.tag == f"{_W}tab":
                out.append("\t")
            elif el.tag == f"{_W}br":
                out.append("\n")
            else:
                walk(el)

    walk(p)
    return "".join(out)


def _is_complex(p) -> bool:
    return any(el.tag in _COMPLEX for el in p.iter())


def dump_docx(data: bytes) -> str:
    """`[p12] 문단 글` 한 줄씩. 빈 문단은 `[p12]` 만."""
    root = ET.fromstring(zipfile.ZipFile(io.BytesIO(data)).read("word/document.xml"))
    body = root.find(f"{_W}body")
    if body is None:
        raise BadOp("docx 본문이 없다")
    lines = []
    for i, p in enumerate(_paragraphs(body)):
        mark = " (읽기 전용 — 링크·필드·그림이 있어 고칠 수 없다)" if _is_complex(p) else ""
        lines.append(f"[p{i}]{mark} {' '.join(_ptext(p).split())}".rstrip())
    return "\n".join(lines)


def apply_docx(data: bytes, ops: list[dict]) -> tuple[bytes, list[Change]]:
    """ops: [{"paragraph": 12, "text": "새 문장"}]. 문단의 첫 run 서식을 그대로 두고 글자만 바꾼다(나머지 run 은 지운다)."""
    src = zipfile.ZipFile(io.BytesIO(data))
    doc_xml = src.read("word/document.xml")
    _register_ns(doc_xml)
    root = ET.fromstring(doc_xml)
    body = root.find(f"{_W}body")
    if body is None:
        raise BadOp("docx 본문이 없다")
    paragraphs = _paragraphs(body)
    changes: list[Change] = []
    for op in ops[:MAX_OPS]:
        idx, text = op.get("paragraph"), op.get("text")
        if (
            type(idx) is not int  # bool 은 int 의 하위 — 「문단 True」를 막는다(리뷰)
            or not (0 <= idx < len(paragraphs))
            or not isinstance(text, str)
        ):
            raise BadOp(f"문단 번호·글이 맞지 않다: {op}")
        p = paragraphs[idx]
        if _is_complex(p):
            raise BadOp(f"문단 {idx} 은 링크·필드·그림이 있어 고칠 수 없다")
        before = _ptext(p)
        _set_text(p, _XML_ILLEGAL_RE.sub("", text))  # XML 금지 문자는 뺀다
        changes.append(Change(where=f"문단 {idx}", before=before, after=text))
    xml = ET.tostring(root, xml_declaration=True, encoding="UTF-8")
    try:
        ET.fromstring(
            xml
        )  # well-formed 확인 — 접두사 충돌·제어문자가 섞였으면 여기서 잡는다(보안 리뷰)
    except ET.ParseError as e:
        raise BadOp("수정 결과가 올바른 XML 이 아니다") from e
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as dst:
        for info in src.infolist():
            if info.filename == "word/document.xml":
                dst.writestr(info, xml)
            else:
                dst.writestr(info, src.read(info))
    return out.getvalue(), changes


def _set_text(p, text: str) -> None:
    runs = [el for el in p if el.tag == f"{_W}r"]
    if runs:
        first, rest = runs[0], runs[1:]
        for r in rest:
            p.remove(r)
        for el in [e for e in first if e.tag in (f"{_W}t", f"{_W}tab", f"{_W}br")]:
            first.remove(el)
    else:
        first = ET.SubElement(p, f"{_W}r")
    # 줄바꿈은 w:br, 탭은 w:tab 으로 — 평면 보기에서 본 모양 그대로 되돌아간다
    for i, line in enumerate(text.split("\n")):
        if i:
            ET.SubElement(first, f"{_W}br")
        for j, seg in enumerate(line.split("\t")):
            if j:
                ET.SubElement(first, f"{_W}tab")
            if seg:
                t = ET.SubElement(first, f"{_W}t")
                t.text = seg
                if seg != seg.strip():
                    t.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")


_XML_NS = "http://www.w3.org/XML/1998/namespace"
_XML_ILLEGAL_RE = re.compile("[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]")


def _register_ns(xml: bytes) -> None:
    """ET 는 다시 쓸 때 접두사를 ns0… 으로 바꾼다. Word 는 `mc:Ignorable="w14 wp14"` 처럼 접두사 이름을 참조하므로
    원본 선언을 등록해 둔다. **파서가 본 실제 선언만**(본문 글자 속 가짜 `xmlns:` 는 제외)이고 예약 접두사·URI 는 건너뛴다 —
    전역 등록이라 한 문서가 다른 모든 수정을 깨뜨릴 수 있었다(보안 리뷰)."""
    for _event, (prefix, uri) in ET.iterparse(io.BytesIO(xml), events=("start-ns",)):
        if prefix and prefix not in ("xml", "xmlns") and uri != _XML_NS:
            try:
                ET.register_namespace(prefix, uri)
            except ValueError:
                pass
