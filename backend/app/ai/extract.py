"""AI 첨부 글자 추출(README 51) — 올린 파일에서 평문을 뽑는다. 신뢰불가 입력 파싱이라 상한을 먼저 건다.

형식: txt·md·csv(UTF-8, 안 되면 CP949) · docx(zip 안 word/document.xml) · xlsx(openpyxl 읽기 전용) ·
pdf(pdfplumber — 문단·표, README 68) · hwpx(zip 안 Contents/section*.xml). 구형 hwp(바이너리)·이미지·그 밖은 `Unsupported`.
글자가 하나도 없으면(스캔 PDF 등) `Empty`. 결과는 MAX_CHARS 에서 자른다 — 프롬프트에 들어갈 때 다시
예산(AI_DOC_MAX_CHARS)에 맞춰 잘린다. CPU 작업이라 호출자는 스레드로 돌린다(`asyncio.to_thread`).
"""

import csv
import io
import json
import re
import subprocess
import sys
import threading
import time
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

import openpyxl

MAX_CHARS = 200_000  # 저장 상한 — 그 뒤는 버린다(프롬프트 예산 5만 자보다 넉넉히)
MAX_ZIP_MEMBER = (
    10 * 1024 * 1024
)  # zip 한 항목 압축 해제 상한 — zip 폭탄(29MB XML 하나가 560MB·5초였다, 보안 리뷰)
# zip 전체 압축 해제 상한(docx·hwpx·xlsx 공통 — openpyxl 은 sharedStrings 를 통째로 올린다)
MAX_ZIP_TOTAL = 30 * 1024 * 1024
MAX_ZIP_ENTRIES = 2000  # 항목 수 — 빈 항목 10만 개로 ZipInfo·이름 색인을 부풀리는 걸 막는다(리뷰). 실제 문서는 수십 개
# PDF 한 건의 시간 상한 — 넘으면 작업자 프로세스를 죽인다. 1KB 파일이 Form XObject 반복(`/X0 Do`)으로 수십 초~수십
# 분을 붙잡을 수 있다(리뷰 재현). 쪽 수(300)·글자·칸·메모리 상한은 작업자(pdfwork.py)가 건다
MAX_PDF_SECONDS = 30.0
_PDF_WORKER = Path(__file__).with_name("pdfwork.py")
_PDF_SLOTS = threading.BoundedSemaphore(
    2
)  # 동시에 뜨는 작업자 수 — AI 첨부 경로엔 다른 동시성 상한이 없다
_CID = re.compile(r"\(cid:\d+\)")
PDF_CUT_NOTE = "(PDF 가 길어 여기서 끊는다)"
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
    text = _clean(text)
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
        len(infos) > MAX_ZIP_ENTRIES
        or any(i.file_size > MAX_ZIP_MEMBER for i in infos)
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


def hwpx_sections(z: zipfile.ZipFile) -> list[str]:
    """Contents/section0.xml, section1.xml … 본문 순서대로. 없으면 hwpx 가 아니다. app/convert.py 도 쓴다."""
    sections = sorted(
        (n for n in z.namelist() if n.startswith("Contents/section") and n.endswith(".xml")),
        key=lambda n: (
            int(m.group()) if (m := re.search(r"\d+", n.rsplit("/", 1)[-1])) else 0
        ),  # section10 이 section2 뒤에(리뷰)
    )
    if not sections:
        raise Unsupported("hwpx")
    return sections


def _hwpx(z: zipfile.ZipFile) -> str:
    """섹션 순서대로 문단. 문단은 자기 직속 run 의 글자만 모은다(표 셀 문단은 따로
    잡히므로 두 번 들어가지 않게), `hp:t` 안의 tab·lineBreak 뒤 글자(.tail)도 살린다(리뷰)."""
    lines: list[str] = []
    for sec in hwpx_sections(z):
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


def _clean(text: str) -> str:
    """DB·Y.Doc·XML 에 못 들어가는 글자를 지운다 — NUL(Postgres text 가 거절, 보안 리뷰)과 나머지 제어 문자(PDF 가 낼 수
    있다. docx·hwpx 내보내기의 XML 에 못 들어간다), 짝 없는 서로게이트(PDF ToUnicode 의 <D800> — UTF-8 로 못 써 500 이었다,
    리뷰)는 `?` 로. 탭·줄바꿈은 남는다."""
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", text)
    return text.encode("utf-8", "replace").decode("utf-8")


def pdf_blocks(data: bytes) -> dict:
    """PDF → 본문 순서의 블록(문단·표) — `pdfwork.py` 를 **별도 프로세스**로 돌린다(README 68). 스레드는 못 끊지만
    프로세스는 죽일 수 있어, 조작된 파일이 MAX_PDF_SECONDS 넘게 CPU 를 붙잡지 못한다(GIL 도 api 와 따로다). 동시에 2개까지.
    돌려주는 모양은 pdfwork 의 docstring. 글자는 `_clean` 을 지난다. app/convert.py 도 쓴다."""
    if not data.startswith(b"%PDF"):
        raise Unsupported("pdf")
    # 시간 상한 하나를 줄 서기와 분석이 나눠 쓴다 — 요청은 끝났는데 줄 선 스레드가 뒤늦게 작업자를 띄우지 않게(Codex 리뷰)
    deadline = time.monotonic() + MAX_PDF_SECONDS
    if not _PDF_SLOTS.acquire(timeout=max(0, MAX_PDF_SECONDS)):
        raise Unsupported("pdf-busy")
    try:
        try:
            proc = subprocess.run(  # noqa: S603 — 인자는 고정, 파일은 표준 입력으로만 간다
                [sys.executable, "-I", str(_PDF_WORKER)],
                input=data,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                timeout=max(0.001, deadline - time.monotonic()),
                check=False,
            )
        except subprocess.TimeoutExpired:
            raise Unsupported("pdf-too-slow") from None
    finally:
        _PDF_SLOTS.release()
    if proc.returncode:
        raise Unsupported("pdf-encrypted" if proc.returncode == 3 else "pdf")
    out = json.loads(proc.stdout)

    def tidy(text: str) -> str:
        # pdfminer 는 유니코드로 못 옮긴 글리프를 「(cid:12)」 로 적는다(글꼴에 대응표가 없는 PDF) — 읽을 수 없는 잡음이라 지운다
        return _clean(_CID.sub("", text))

    for block in out["blocks"]:
        if block["t"] == "p":
            block["text"] = tidy(block["text"])
        else:
            for row in block["rows"]:
                for cell in row:
                    cell["text"] = tidy(cell["text"])
    return out


def _pdf(data: bytes) -> str:
    """문단은 한 줄, 표는 행마다 ' | '(docx 와 같은 모양) — AI 가 칸을 구분해 읽는다."""
    out = pdf_blocks(data)
    lines: list[str] = []
    for block in out["blocks"]:
        if block["t"] == "p":
            lines.append(block["text"])
        else:
            lines += [
                " | ".join(c["text"].replace("\n", " ") for c in row) for row in block["rows"]
            ]
    if out["cut"]:
        lines.append(PDF_CUT_NOTE)
    return "\n".join(lines)
