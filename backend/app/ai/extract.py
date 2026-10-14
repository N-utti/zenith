"""AI 첨부 글자 추출(README 51) — 올린 파일에서 평문을 뽑는다. 신뢰불가 입력 파싱이라 상한을 먼저 건다.

형식: txt·md·csv(UTF-8, 안 되면 CP949) · docx(zip 안 word/document.xml) · xlsx(openpyxl 읽기 전용) ·
pdf(pypdf) · hwpx(zip 안 Contents/section*.xml). 구형 hwp(바이너리)·이미지·그 밖은 `Unsupported`.
글자가 하나도 없으면(스캔 PDF 등) `Empty`. 결과는 MAX_CHARS 에서 자른다 — 프롬프트에 들어갈 때 다시
예산(AI_DOC_MAX_CHARS)에 맞춰 잘린다. CPU 작업이라 호출자는 스레드로 돌린다(`asyncio.to_thread`).
"""

import csv
import io
import re
import xml.etree.ElementTree as ET
import zipfile

import openpyxl
import pypdf

MAX_CHARS = 200_000  # 저장 상한 — 그 뒤는 버린다(프롬프트 예산 5만 자보다 넉넉히)
MAX_ZIP_MEMBER = (
    10 * 1024 * 1024
)  # zip 한 항목 압축 해제 상한 — zip 폭탄(29MB XML 하나가 560MB·5초였다, 보안 리뷰)
# zip 전체 압축 해제 상한(docx·hwpx·xlsx 공통 — openpyxl 은 sharedStrings 를 통째로 올린다)
MAX_ZIP_TOTAL = 30 * 1024 * 1024
MAX_PDF_STREAM = (
    20 * 1024 * 1024
)  # PDF 내용 스트림 누적 상한 — 102KB 파일이 풀면 40MB·300초였다(보안 리뷰)
MAX_PDF_PAGES = 300
MAX_XLSX_CELLS = 200_000
SUPPORTED = ("txt", "md", "csv", "docx", "xlsx", "pdf", "hwpx")

_W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
_HP = "{http://www.hancom.co.kr/hwpml/2011/paragraph}"


class Unsupported(ValueError):
    """형식을 모르거나 깨진 파일(확장자·서명·파싱 오류)."""


class Empty(ValueError):
    """읽을 글자가 없다(스캔 PDF·빈 표)."""


def extract(name: str, data: bytes) -> str:
    """파일 이름의 확장자로 가르고, zip 계열은 서명까지 본다. 돌려주는 글은 MAX_CHARS 이내.
    파서가 내는 어떤 예외든 `Unsupported` 로 — 깨진 파일이 500 이 되지 않게(리뷰)."""
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    if ext not in SUPPORTED:
        raise Unsupported(ext)
    try:
        if ext in ("txt", "md"):
            text = _decode(data)
        elif ext == "csv":
            text = _csv(_decode(data))
        elif ext == "docx":
            text = _docx(_zip(data))
        elif ext == "hwpx":
            text = _hwpx(_zip(data))
        elif ext == "xlsx":
            _zip(data).close()  # 서명·압축 해제 총량 상한은 여기서, 읽기는 openpyxl 이
            text = _xlsx(data)
        else:
            text = _pdf(data)
    except (Unsupported, Empty):
        raise
    except Exception as e:  # noqa: BLE001 — ET.ParseError·zlib.error·_csv.Error·RuntimeError(암호 zip)… 전부 형식 오류
        raise Unsupported(ext) from e
    text = "\n".join(line.rstrip() for line in text.splitlines())
    text = re.sub(r"\n{3,}", "\n\n", text).strip()  # 빈 줄 연속은 둘로 — 예산을 먹지 않게(리뷰)
    text = text.replace(
        "\x00", ""
    )  # Postgres text 는 NUL 을 거절한다(위장 바이너리·PDF 출력, 보안 리뷰)
    if not text:
        raise Empty(ext)
    return text[:MAX_CHARS]


def _decode(data: bytes) -> str:
    try:
        return data.decode("utf-8-sig")
    except UnicodeDecodeError:
        return data.decode("cp949", errors="replace")


def _csv(text: str) -> str:
    rows = csv.reader(io.StringIO(text))
    return "\n".join(" | ".join(c.strip() for c in row) for row in rows)


def _zip(data: bytes) -> zipfile.ZipFile:
    if not data.startswith(b"PK"):
        raise Unsupported("zip")
    z = zipfile.ZipFile(io.BytesIO(data))  # BadZipFile 은 extract() 가 Unsupported 로 바꾼다
    infos = z.infolist()
    if (
        any(i.file_size > MAX_ZIP_MEMBER for i in infos)
        or sum(i.file_size for i in infos) > MAX_ZIP_TOTAL
    ):
        raise Unsupported(
            "zip-too-large"
        )  # 선언 크기 기준 — CPython 은 읽을 때 선언 크기에서 출력을 끊는다
    return z


def _docx(z: zipfile.ZipFile) -> str:
    """본문 순서대로 문단·표(셀은 ' | '). 콘텐츠 컨트롤(w:sdt)·customXml 안의 문단·표도 같은 순서로(리뷰)."""
    if "word/document.xml" not in z.namelist():
        raise Unsupported("docx")
    body = ET.fromstring(z.read("word/document.xml")).find(f"{_W}body")
    if body is None:
        raise Empty("docx")
    lines: list[str] = []
    _docx_walk(body, lines)
    return "\n".join(lines)


def _docx_walk(node, lines: list[str]) -> None:
    for el in node:
        if el.tag == f"{_W}p":
            lines.append(_wtext(el))
        elif el.tag == f"{_W}tbl":
            for tr in el.iter(f"{_W}tr"):
                cells = [
                    "\n".join(_wtext(p) for p in tc.iter(f"{_W}p")).strip()
                    for tc in tr.iter(f"{_W}tc")
                ]
                lines.append(" | ".join(cells))
        elif el.tag in (f"{_W}sdt", f"{_W}customXml", f"{_W}sdtContent", f"{_W}customXmlPr"):
            _docx_walk(el, lines)  # 안의 문단·표를 같은 규칙으로


def _wtext(p) -> str:
    """문단 글자 — w:tab 은 탭, w:br 은 줄바꿈으로(「이름<tab>값」이 붙지 않게, 리뷰)."""
    out: list[str] = []
    for el in p.iter():
        if el.tag == f"{_W}t":
            out.append(el.text or "")
        elif el.tag == f"{_W}tab":
            out.append("	")
        elif el.tag == f"{_W}br":
            out.append("\n")
    return "".join(out)


def _hwpx(z: zipfile.ZipFile) -> str:
    """Contents/section0.xml, section1.xml … 순서대로 문단. 문단은 자기 직속 run 의 글자만 모은다(표 셀 문단은 따로
    잡히므로 두 번 들어가지 않게), `hp:t` 안의 tab·lineBreak 뒤 글자(.tail)도 살린다(리뷰)."""
    sections = sorted(
        (n for n in z.namelist() if n.startswith("Contents/section") and n.endswith(".xml")),
        key=lambda n: (
            int(m.group()) if (m := re.search(r"\d+", n.rsplit("/", 1)[-1])) else 0
        ),  # section10 이 section2 뒤에(리뷰)
    )
    if not sections:
        raise Unsupported("hwpx")
    lines: list[str] = []
    for sec in sections:
        root = ET.fromstring(z.read(sec))
        for p in root.iter(f"{_HP}p"):
            parts: list[str] = []
            for t in p.findall(f"{_HP}run/{_HP}t"):
                parts.append(t.text or "")
                for child in t:
                    tag = child.tag.removeprefix(_HP)
                    parts.append("\t" if tag == "tab" else "\n" if tag == "lineBreak" else "")
                    parts.append(child.tail or "")
            line = "".join(parts)
            if not line and p.findall(f"{_HP}run/{_HP}tbl"):
                continue  # 표를 담는 바깥 문단 — 글자가 없으면 빈 줄로 남기지 않는다(셀 문단이 따로 온다)
            lines.append(line)
    return "\n".join(lines)


def _xlsx(data: bytes) -> str:
    """시트마다 「## 시트명」 뒤에 행을 ' | ' 로. 셀 수 상한에서 끊는다(수식은 저장된 값만 — 없으면 빈 칸)."""
    wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    lines: list[str] = []
    cells = 0
    try:
        for ws in wb.worksheets:
            lines.append(f"## {ws.title}")
            for row in ws.iter_rows(values_only=True):
                if cells > MAX_XLSX_CELLS:
                    lines.append("(셀 상한을 넘어 여기서 끊는다)")
                    return "\n".join(lines)
                cells += len(row)
                if any(v is not None for v in row):
                    lines.append(" | ".join("" if v is None else str(v) for v in row))
    finally:
        wb.close()
    return "\n".join(lines)


def _pdf(data: bytes) -> str:
    # ponytail: 조작된 PDF 가 pypdf 에서 CPU 를 오래 붙잡을 수 있다 — 스레드에서 돌고 10MB·300쪽 상한뿐. 잦으면 시간 상한.
    if not data.startswith(b"%PDF"):
        raise Unsupported("pdf")
    reader = pypdf.PdfReader(io.BytesIO(data))
    if reader.is_encrypted:
        raise Unsupported("pdf-encrypted")
    parts: list[str] = []
    total = 0
    for page in reader.pages[:MAX_PDF_PAGES]:
        c = page.get_contents()
        total += len(c.get_data()) if c is not None else 0
        if total > MAX_PDF_STREAM:
            raise Unsupported("pdf-too-large")
        parts.append(page.extract_text() or "")
    return "\n".join(parts)
