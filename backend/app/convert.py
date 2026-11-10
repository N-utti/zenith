"""파일 → 문서 본문 HTML(README 60·62) — docx·xlsx·hwpx 를 편집기(Tiptap)가 읽는 HTML 로 바꾼다.

이 HTML 은 app/ydoc.py 가 Y.Doc 으로 옮긴다(README 61). 편집기 스키마와 어긋난 노드는 Tiptap 이 통째로 버리므로
태그는 ALLOWED 로 좁히고 속성은 정해진 것만 남긴다: colspan·rowspan(셀), href(링크, http·https·mailto),
style="text-align:…"(문단·제목 정렬), style="color:#rrggbb"(span 글자색), data-color(mark 형광펜),
data-ref·width·alt(img — 파일 안의 그림, data-ref 는 `Converted.images` 의 번호). 원본 HTML 이 그대로 통과하는 경로는
없다 — 셋 다 여기서 escape 해 만든 뒤 같은 필터(`_Filter`)를 지난다.

서식(README 62)은 편집기가 가진 것까지만: 제목·정렬·굵게·기울임·밑줄·취소선·글자색·형광펜·링크·목록·표·그림.
글꼴·크기·줄간격은 편집기에 없어 싣지 않는다. 내보내기(frontend exportDoc)가 싣는 서식과 같은 집합이라 왕복이 맞는다.

상한: 올리는 파일은 10MB(라우터)지만 압축을 풀면 훨씬 클 수 있어 본문 XML 은 MAX_XML_BYTES 에서 거절하고, zip
항목·총량·셀 수는 ai/extract.py 의 것을 그대로 쓴다. 그림은 MAX_IMAGES 장·장당 MAX_IMAGE_BYTES, png·jpeg·gif·webp 만
(storage.sniff_image). 결과는 심을 때 **Yjs 업데이트 하나**가 되므로 글자 바이트 + 요소마다 TAG_COST 로 크기를
어림해 MAX_SEED_COST 에서 행·항목·블록 경계로 끊는다(빈 셀 하나가 Yjs 로는 130 바이트다). CPU 작업이라 호출자는
스레드로 돌린다(`asyncio.to_thread`).
"""

import hashlib
import html
import io
import posixpath
import re
import xml.etree.ElementTree as ET
import zipfile
from dataclasses import dataclass, field
from html.parser import HTMLParser

import openpyxl

from app import storage
from app.ai.extract import _HP, MAX_XLSX_CELLS, Empty, Unsupported, _zip, hwpx_sections

SUPPORTED = ("docx", "xlsx", "hwpx")
TIMEOUT_S = 60.0  # 변환 한 건 상한 — 스레드는 못 끊지만 요청은 422 로 돌려준다(ai.py ATTACH_EXTRACT_TIMEOUT_S 와 같다)
MAX_XML_BYTES = (
    2 * 1024 * 1024
)  # 본문 XML(document.xml·section*.xml 합) 압축 해제 상한 — 한글 70만 자, 결과 상한의 몇 배
MAX_SEED_COST = 500_000  # Yjs 업데이트 어림 바이트 — MAX_FRAME(1MB)의 절반
TAG_COST = 64  # 요소 하나의 Yjs 몫 어림(실측: tableCell+paragraph+글자 1 = 130 바이트)
MAX_CELLS = MAX_SEED_COST // (
    2 * TAG_COST
)  # 빈 칸 하나 = td+p 두 요소 — 이보다 많은 칸은 어차피 필터가 끊는다(리뷰)
MAX_IMAGES = 50  # 문서 하나에서 꺼내는 그림 수 — 하루 업로드 상한(200)의 1/4
MAX_IMAGE_BYTES = 10 * 1024 * 1024  # routers/files.MAX_FILE_BYTES 와 같다
TRUNCATED_NOTE = "<p><em>(파일이 길어 여기서 끊었습니다. 나머지는 원본 파일을 여세요.)</em></p>"

# 편집기 확장(frontend editorExtensions.ts)이 읽는 태그만. 그 밖은 태그만 벗기고 글자는 남긴다.
_BLOCK = frozenset(
    "p h1 h2 h3 h4 h5 h6 ul ol li table thead tbody tr th td pre blockquote hr img".split()
)
_INLINE = frozenset("strong em u s a br code span mark".split())
ALLOWED = _BLOCK | _INLINE
_VOID = frozenset({"br", "hr", "img"})
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
_ALIGNS = ("center", "right", "justify")  # left 는 기본값이라 싣지 않는다
_ALIGN_RE = re.compile(r"text-align\s*:\s*(center|right|justify)\b", re.IGNORECASE)
_COLOR_RE = re.compile(r"^#([0-9a-f]{6}|[0-9a-f]{3})$", re.IGNORECASE)
_SPAN_COLOR_RE = re.compile(r"(?<![-\w])color\s*:\s*(#[0-9a-f]{3,6})\b", re.IGNORECASE)
MAX_ALT = 200
# 서식 3차(README 63) — 편집기 속성 계약(#574)과 같은 범위·단위. 값은 늘 여기서 다시 써서 꼬리가 남지 않는다
_LINE_HEIGHT_RE = re.compile(
    r"line-height\s*:\s*(\d+(?:\.\d+)?)\s*(?:;|$)", re.IGNORECASE | re.ASCII
)
_MARGIN_RE = {
    k: re.compile(rf"{k}\s*:\s*(\d+)px\b", re.IGNORECASE | re.ASCII)
    for k in ("margin-left", "margin-top", "margin-bottom")
}
_FONT_FAMILY_RE = re.compile(r"font-family\s*:\s*([^;]+)", re.IGNORECASE)
_FONT_SIZE_RE = re.compile(r"font-size\s*:\s*(\d+(?:\.\d+)?)pt\b", re.IGNORECASE | re.ASCII)
_BG_RE = re.compile(r"background-color\s*:\s*(#[0-9a-f]{3,6})\b", re.IGNORECASE)
_WIDTH_RE = re.compile(r"(?<![-\w])width\s*:\s*(\d+)px\b", re.IGNORECASE | re.ASCII)
# 서식 4차(README 64) — 행 높이(tr)·칸 변 테두리(td·th). 값은 계약(#574) 모양 그대로: `1px solid #000000` 또는 `none`
_HEIGHT_RE = re.compile(r"(?<![-\w])height\s*:\s*(\d{1,4})px\b", re.IGNORECASE | re.ASCII)
_BORDER_RE = re.compile(
    r"border-(top|right|bottom|left)\s*:\s*(?:(none)|([1-8])px\s+(solid|dashed|dotted|double)\s+(#[0-9a-f]{3,6}))\b",
    re.IGNORECASE | re.ASCII,
)
MAX_ROW_HEIGHT = 2000
_PLAIN_BORDER = "1px solid #000000"  # 편집기 기본 선과 같은 값 — 싣지 않는다
_SIDE_NAMES = {  # docx 는 left/right 를 start/end 로 적기도 한다
    "top": ("top",),
    "right": ("right", "end"),
    "bottom": ("bottom",),
    "left": ("left", "start"),
}
_MM_RE = re.compile(r"\s*(\d{1,3}(?:\.\d+)?)\s*mm")
_FONT_OK = re.compile(
    r"[^\w\s가-힣.,\-]"
)  # 글꼴 이름에 남길 글자 — 따옴표는 전부 지우고 필요하면 _font 가 다시 감싼다
MAX_FONT = 100


class TooLarge(ValueError):
    """본문 XML 이 MAX_XML_BYTES 를 넘는다 — 형식은 맞지만 받지 않는다."""


def _parse_xml(z: zipfile.ZipFile, path: str):
    """zip 안 XML 하나. 없으면 None. 크기는 MAX_XML_BYTES(본문뿐 아니라 styles·numbering·rels·header 도 — 9MB 빈 스타일
    반복이 9초·115MB 였다, 리뷰), DOCTYPE·내부 엔티티는 거부(474바이트가 6.9MB 로 부풀었다, Codex) — 워드·한글은 안 쓴다."""
    if path not in z.namelist():
        return None
    if z.getinfo(path).file_size > MAX_XML_BYTES:
        raise TooLarge(path)
    raw = z.read(path)
    if b"<!DOCTYPE" in raw or b"<!ENTITY" in raw:
        raise Unsupported("xml-dtd")
    return ET.fromstring(raw)


@dataclass
class Converted:
    html: str
    truncated: bool
    # 파일 안의 그림(바이트, content type). html 의 `<img data-ref="i">` 가 i 번째를 가리킨다 — 올리는 건 라우터가
    images: list[tuple[bytes, str]] = field(default_factory=list)


def to_html(name: str, data: bytes) -> Converted:
    """확장자로 가르고 zip 서명·상한은 `_zip` 이 본다. 파서가 내는 어떤 예외든 `Unsupported` 로
    — 깨진 파일이 500 이 되지 않게(extract.extract 와 같은 규칙). 글자도 그림도 없으면 `Empty`."""
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    if ext not in SUPPORTED:
        raise Unsupported(ext)
    images: list[tuple[bytes, str]] = []
    try:
        if ext == "docx":
            raw, cut = _Docx(_zip(data), images).run()
        elif ext == "xlsx":
            raw, cut = _xlsx(data)
        else:
            raw, cut = _Hwpx(_zip(data), images).run()
    except (Unsupported, Empty, TooLarge):
        raise
    except Exception as e:  # noqa: BLE001 — ET.ParseError·KeyError(zip 항목 없음)·zlib.error… 전부 형식 오류
        raise Unsupported(ext) from e
    f = _Filter(len(images))
    f.feed(raw)
    f.close()
    if f.chars == 0 and not f.images:
        raise Empty(ext)
    body, truncated = f.result()
    if cut and not truncated:
        body += TRUNCATED_NOTE  # 형식 단계(셀 상한)에서 끊겼지만 결과는 작다 — 안내는 붙인다
    return Converted(body, truncated or cut, images)


def _digits(value: str | None) -> bool:
    """ASCII 숫자만, 9자리까지. `isdigit()` 는 `²` 도 참이고 int() 는 4300자리에서 ValueError 다(리뷰)."""
    return bool(value) and value.isascii() and value.isdigit() and len(value) <= 9


def _hex(value: str | None) -> str | None:
    """`#abc`·`#aabbcc`·`aabbcc`·`FFaabbcc`(ARGB) → `#aabbcc` 소문자. 아니면 None."""
    if not value:
        return None
    v = value.strip().lstrip("#")
    if len(v) == 8:
        v = v[2:]
    if len(v) == 3:
        v = "".join(c * 2 for c in v)
    return f"#{v.lower()}" if re.fullmatch(r"[0-9a-fA-F]{6}", v) else None


def _font(raw: str | None) -> str | None:
    """글꼴 이름 — 계약에 맞는 글자만 남기고(홑따옴표·쉼표 허용) 100자. 공백이 있으면 홑따옴표로 감싼다."""
    if not raw:
        return None
    # 따옴표가 닫히지 않은 속성값엔 뒤따르는 태그가 통째로 들어온다 — 첫 `<` 에서 자른다
    name = (
        _FONT_OK.sub("", raw.split("<")[0].replace('"', "'")).strip().strip("'").strip()[:MAX_FONT]
    )
    if not name:
        return None
    return f"'{name}'" if " " in name and "," not in name else name


def _pt(value: float | None) -> str | None:
    """글자 크기 pt — 4~96 사이만, 정수면 정수로."""
    if value is None or not (4 <= value <= 96):
        return None
    return f"{int(value)}" if float(value).is_integer() else f"{round(value, 1)}"


def _wrap(
    text: str,
    *,
    bold=False,
    italic=False,
    underline=False,
    strike=False,
    color=None,
    bg=None,
    href=None,
    font=None,
    size=None,
) -> str:
    """글자 조각을 마크 태그로 감싼다. 빈 글자는 그대로(빈 마크 태그를 만들지 않게). 글자색·글꼴·크기는 span 하나의 style 로."""
    if not text:
        return text
    if bold:
        text = f"<strong>{text}</strong>"
    if italic:
        text = f"<em>{text}</em>"
    if underline:
        text = f"<u>{text}</u>"
    if strike:
        text = f"<s>{text}</s>"
    if bg:
        text = f'<mark data-color="{bg}">{text}</mark>'
    styles = []
    if color:
        styles.append(f"color:{color}")
    if font:
        styles.append(f"font-family:{font}")
    if size:
        styles.append(f"font-size:{size}pt")
    if styles:
        text = f'<span style="{";".join(styles)}">{text}</span>'
    if href:
        text = f'<a href="{html.escape(href, quote=True)}">{text}</a>'
    return text


def _block(tag: str, inner: str, align: str | None, extra: dict | None = None) -> str:
    """문단·제목. `extra` 는 계약의 문단 속성 — line_height(배수), indent·space_before·space_after(px)."""
    parts = []
    if align in _ALIGNS:
        parts.append(f"text-align:{align}")
    extra = extra or {}
    if lh := extra.get("line_height"):
        parts.append(f"line-height:{lh}")
    for key, prop in (
        ("indent", "margin-left"),
        ("space_before", "margin-top"),
        ("space_after", "margin-bottom"),
    ):
        if extra.get(key):
            parts.append(f"{prop}:{extra[key]}px")
    style = f' style="{";".join(parts)}"' if parts else ""
    return f"<{tag}{style}>{inner}</{tag}>"


def _px_from_twips(value: str | None) -> int | None:
    """워드 twip(1/20pt) → px. 0 은 None(싣지 않는다)."""
    if not _digits(value) or int(value) <= 0:
        return None
    return round(int(value) / 15)


def _px_from_hwpunit(value: str | None) -> int | None:
    """한글 HWPUNIT(1/7200 inch) → px."""
    if not _digits(value) or int(value) <= 0:
        return None
    return round(int(value) / _HWPUNIT_PER_PX)


def _px_from_mm(value: str | None) -> float | None:
    """한글 선 굵기 `"0.12 mm"` → px."""
    m = _MM_RE.match(value or "")
    return float(m.group(1)) * 96 / 25.4 if m else None


def _border_css(style: str | None, px: float | None, color: str | None) -> str | None:
    """칸 한 변 → 계약(#574) 값 `"1px solid #000000"` 또는 `"none"`. style 이 없으면 정해진 게 없다(None) — 편집기 기본 선."""
    if not style:
        return None
    kind = style.strip().lower()
    if kind in ("none", "nil"):
        return "none"
    width = min(8, max(1, round(px or 1)))
    return f"{width}px {_border_kind(kind)} {_hex(color) or '#000000'}"


def _border_kind(kind: str) -> str:
    """워드 w:val(dashed·dotDash·thinThickSmallGap…)·한글 type(DASH_DOT·DOT·SLIM_THICK…) → CSS 선 종류 넷."""
    if "dash" in kind:
        return "dashed"
    if "dot" in kind or kind == "circle":  # 한글 CIRCLE 은 동그란 점선
        return "dotted"
    if "double" in kind or "thick" in kind or "triple" in kind:
        return "double"
    return "solid"


def _cell_border_style(sides: dict[str, str | None], borderless: bool) -> list[str]:
    """칸 네 변 중 실을 것 — 표가 테두리 없음이면 `none` 은 이미 그렇고, 아니면 기본 선과 같은 값은 싣지 않는다."""
    skip = "none" if borderless else _PLAIN_BORDER
    return [
        f"border-{side}:{css}"
        for side in ("top", "right", "bottom", "left")
        if (css := sides.get(side)) and css != skip
    ]


def _line_height(ratio: float | None) -> str | None:
    """줄 간격 배수 — 0.5~5, 1.0 은 기본이라 싣지 않는다."""
    if ratio is None or not (0.5 <= ratio <= 5) or abs(ratio - 1.0) < 0.01:
        return None
    return f"{round(ratio, 2):g}"


# ── 필터 ─────────────────────────────────────────────────────────────────────────


class _Filter(HTMLParser):
    """허용 태그·속성만 다시 써서 HTML 을 만든다. 열린 태그 스택을 들고 있어 끝에 닫히지 않은 태그를 닫고,
    행(tr)·항목(li)·최상위 블록이 끝나는 자리를 기억해 두었다가 어림 비용이 MAX_SEED_COST 를 넘으면 그 자리에서 끊는다."""

    def __init__(self, n_images: int = 0) -> None:
        super().__init__(convert_charrefs=True)
        self.out: list[str] = []
        self.cost = 0  # 글자 바이트 + 요소마다 TAG_COST
        self.stack: list[str] = []
        self.chars = 0  # 공백이 아닌 글자 수 — 그림도 없이 0 이면 Empty
        self.images = 0  # 살아남은 그림 수
        self.n_images = n_images  # data-ref 가 가리킬 수 있는 범위
        self.cuts: list[tuple[int, int, list[str]]] = []  # (out 길이, 그때 비용, 열린 태그)
        self.drop = 0  # _DROP 안 깊이
        self.implicit_p = False  # 블록 밖 글자를 감싸려고 우리가 연 <p>

    def _emit(self, s: str, cost: int = 0) -> None:
        self.out.append(s)
        self.cost += cost

    def _attrs(self, tag: str, attrs: list[tuple[str, str | None]]) -> dict[str, str] | None:
        """남길 속성. None 이면 태그 자체를 벗긴다(주소 없는 a, 색 없는 span, 번호 없는 img)."""
        kept: dict[str, str] = {}  # 같은 속성이 두 번 오면 마지막 것 — 하나만 남긴다
        for key, value in attrs:
            if value is None:
                continue
            value = value.strip()
            if tag == "a" and key == "href" and len(value) <= MAX_HREF and _HREF_OK.match(value):
                kept["href"] = value
            elif tag in ("td", "th") and key in ("colspan", "rowspan"):
                if _digits(value) and 1 <= int(value) <= MAX_SPAN:
                    kept[key] = value
            elif tag in ("p", "h1", "h2", "h3", "h4", "h5", "h6") and key == "style":
                parts = []
                if m := _ALIGN_RE.search(value):
                    parts.append(f"text-align:{m.group(1).lower()}")
                if (m := _LINE_HEIGHT_RE.search(value)) and (lh := _line_height(float(m.group(1)))):
                    parts.append(f"line-height:{lh}")
                for prop, limit in (
                    ("margin-left", 2000),
                    ("margin-top", 500),
                    ("margin-bottom", 500),
                ):
                    if (m := _MARGIN_RE[prop].search(value)) and 0 < int(m.group(1)) <= limit:
                        parts.append(f"{prop}:{m.group(1)}px")
                if parts:
                    kept["style"] = ";".join(parts)
            elif tag == "span" and key == "style":
                parts = []
                if (m := _SPAN_COLOR_RE.search(value)) and (c := _hex(m.group(1))):
                    parts.append(f"color:{c}")
                if (m := _FONT_FAMILY_RE.search(value)) and (f := _font(m.group(1))):
                    parts.append(f"font-family:{f}")
                if (m := _FONT_SIZE_RE.search(value)) and (sz := _pt(float(m.group(1)))):
                    parts.append(f"font-size:{sz}pt")
                if parts:
                    kept["style"] = ";".join(parts)
            elif tag in ("td", "th") and key == "style":
                parts = []
                if (m := _BG_RE.search(value)) and (c := _hex(m.group(1))):
                    parts.append(f"background-color:{c}")
                if (m := _WIDTH_RE.search(value)) and 0 < int(m.group(1)) <= 4000:
                    parts.append(f"width:{m.group(1)}px")
                sides: dict[str, str] = {}  # 같은 변이 두 번 오면 마지막 것
                for m in _BORDER_RE.finditer(value):
                    if m.group(2):
                        sides[m.group(1).lower()] = "none"
                    elif c := _hex(m.group(5)):
                        sides[m.group(1).lower()] = f"{m.group(3)}px {m.group(4).lower()} {c}"
                parts += [f"border-{side}:{css}" for side, css in sides.items()]
                if parts:
                    kept["style"] = ";".join(parts)
            elif tag == "tr" and key == "style":
                if (m := _HEIGHT_RE.search(value)) and 0 < int(m.group(1)) <= MAX_ROW_HEIGHT:
                    kept["style"] = f"height:{m.group(1)}px"
            elif tag == "table" and key == "data-borders" and value == "none":
                kept["data-borders"] = "none"
            elif tag == "mark" and key == "data-color":
                if c := _hex(value):
                    kept["data-color"] = c
            elif tag == "img":
                if key == "data-ref" and _digits(value) and int(value) < self.n_images:
                    kept["data-ref"] = value
                elif key == "width" and _digits(value) and 0 < int(value) <= 4000:
                    kept["width"] = value
                elif key == "alt" and value:
                    kept["alt"] = value[:MAX_ALT]
        if (
            (tag == "a" and "href" not in kept)
            or (tag == "span" and not kept)
            or (tag == "img" and "data-ref" not in kept)
        ):
            return None
        return kept

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in _DROP:
            self.drop += 1
            return
        if self.drop or tag not in ALLOWED:
            return
        kept = self._attrs(tag, attrs)
        if kept is None:
            return  # 주소가 없거나 javascript: 같은 것 — 링크(색 없는 span, 번호 없는 img)를 벗기고 글자만 남긴다
        if self.implicit_p and tag in _BLOCK:
            self.handle_endtag("p")
        if not self.stack and tag in _INLINE and tag not in _VOID:
            self._open_implicit_p()  # 블록 밖 링크·굵게 — 글자와 같은 규칙으로 문단에 넣는다
        # 속성값은 큰따옴표 안이라 `"`·`&`·`<`·`>` 만 escape — 글꼴 이름의 홑따옴표(`'맑은 고딕'`)는 그대로
        attr_html = "".join(
            f' {k}="{html.escape(v, quote=False).replace(chr(34), "&quot;")}"'
            for k, v in kept.items()
        )
        self._emit(f"<{tag}{attr_html}>", TAG_COST + len(attr_html.encode()))
        if tag == "img":
            self.images += 1
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


# ── 그림 ─────────────────────────────────────────────────────────────────────────


def _image_tag(
    z: zipfile.ZipFile,
    path: str,
    images: list[tuple[bytes, str]],
    width_px: int | None,
    seen: dict[str, int],
) -> str:
    """zip 안의 그림을 꺼내 `images` 에 넣고 `<img data-ref>` 를 돌려준다. 같은 파일을 여러 번 넣은 문서는 한 번만
    올린다(`seen`: 경로 → 번호). 형식이 아니거나(emf·wmf·svg) 너무 크거나 장수가 찼으면 빈 문자열 — 그 자리는 조용히
    비운다(사진 한 장 때문에 가져오기를 막지 않는다)."""
    width = f' width="{width_px}"' if width_px and 0 < width_px <= 4000 else ""
    if path in seen:
        return f'<img data-ref="{seen[path]}"{width}>'
    if path not in z.namelist() or z.getinfo(path).file_size > MAX_IMAGE_BYTES:
        return ""
    data = z.read(path)
    content_type = storage.sniff_image(data)
    if content_type is None:
        return ""
    digest = (
        "sha1:" + hashlib.sha1(data).hexdigest()
    )  # 같은 바이트가 다른 이름으로 들어 있어도 한 장(Codex)
    if digest not in seen:
        if len(images) >= MAX_IMAGES:
            return ""
        images.append((data, content_type))
        seen[digest] = len(images) - 1
    seen[path] = seen[digest]
    return f'<img data-ref="{seen[path]}"{width}>'


# ── docx ─────────────────────────────────────────────────────────────────────────

_W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
_R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
_A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
_WP = "{http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing}"
_V = "{urn:schemas-microsoft-com:vml}"
_REL = "{http://schemas.openxmlformats.org/package/2006/relationships}"
_EMU_PER_PX = 9525
# w:highlight 의 이름 → 색. 워드 형광펜 16색
_HIGHLIGHT = {
    "yellow": "#ffff00",
    "green": "#00ff00",
    "cyan": "#00ffff",
    "magenta": "#ff00ff",
    "blue": "#0000ff",
    "red": "#ff0000",
    "darkBlue": "#000080",
    "darkCyan": "#008080",
    "darkGreen": "#008000",
    "darkMagenta": "#800080",
    "darkRed": "#800000",
    "darkYellow": "#808000",
    "darkGray": "#808080",
    "lightGray": "#c0c0c0",
    "black": "#000000",
}
_JC = {
    "center": "center",
    "right": "right",
    "end": "right",
    "both": "justify",
    "distribute": "justify",
}
# 문단·표를 안에 담는 껍데기 — 같은 순서로 들어가 본다(콘텐츠 컨트롤·customXml, extract.py 와 같게)
_CONTAINERS = {f"{_W}sdt", f"{_W}sdtContent", f"{_W}customXml", f"{_W}smartTag", f"{_W}ins"}


def _on(el, tag: str) -> bool:
    """`<w:b/>`·`<w:b w:val="1"/>` 은 켜짐, `w:val="0"|"false"` 는 꺼짐, 없으면 꺼짐."""
    node = el.find(_W + tag) if el is not None else None
    return node is not None and node.get(f"{_W}val", "1").lower() not in ("0", "false", "none")


class _Docx:
    """document.xml 을 본문 순서대로 걷는다 — 제목(styles.xml 의 heading n, basedOn 추적)·정렬(jc)·목록(numbering.xml 의
    numFmt, ilvl 중첩)·표(gridSpan·tblHeader; vMerge 이어지는 칸은 빈 칸)·run 서식(b·i·u·strike·color·highlight/shd)·
    하이퍼링크(rels 의 External)·그림(a:blip r:embed → word/media, 폭은 wp:extent EMU → px).
    ponytail: 스타일에 걸린 서식(제목 스타일의 굵게 등)·run 스타일(rStyle)은 따라가지 않는다 — 제목은 h 태그가 대신한다."""

    def __init__(self, z: zipfile.ZipFile, images: list[tuple[bytes, str]]) -> None:
        self.z = z
        self.images = images
        if "word/document.xml" not in z.namelist():
            raise Unsupported("docx")
        if z.getinfo("word/document.xml").file_size > MAX_XML_BYTES:
            raise TooLarge("docx")
        self.styles = self._styles()
        self.nums = self._numbering()
        self.rels = self._rels()
        self.theme = self._theme()
        self._lifted: list[str] = []  # 칸 안의 표 — 바깥 표 바로 뒤에 낸다(서식 4차)
        self.cells = 0  # 지금까지 낸 칸 수 — MAX_CELLS 를 넘으면 표를 더 만들지 않는다(gridBefore 63 빈 행 2만 개 = 65초, 리뷰)
        self.cut = False
        self.default_line: str | None = None
        self.default_font, self.default_size = self._defaults()
        self.out: list[str] = []
        self.lists: list[
            tuple[str, bool, str]
        ] = []  # 열린 목록 (태그, 항목이 열려 있나, numId) — 깊이 = ilvl
        self.seen: dict[str, int] = {}  # 이미 꺼낸 그림 경로 → 번호

    def _xml(self, path: str):
        return _parse_xml(self.z, path)

    def _styles(self) -> dict[str, tuple[str, str | None]]:
        root = self._xml("word/styles.xml")
        out: dict[str, tuple[str, str | None]] = {}
        if root is None:
            return out
        for st in root.iter(f"{_W}style"):
            sid = st.get(f"{_W}styleId")
            name = st.find(f"{_W}name")
            based = st.find(f"{_W}basedOn")
            if sid:
                out[sid] = (
                    (name.get(f"{_W}val", "") if name is not None else "").lower(),
                    based.get(f"{_W}val") if based is not None else None,
                )
        return out

    def _theme(self) -> dict[str, str]:
        """theme1.xml 의 글꼴 구성 — 워드 기본 서식은 글꼴 이름 대신 `w:eastAsiaTheme="minorEastAsia"` 처럼 테마를 가리킨다(실제
        파일 확인). {"minor:ea": "맑은 고딕", "minor:latin": …, "major:…"}. 한글 문서는 `a:font script="Hang"` 이 ea 보다 우선."""
        out: dict[str, str] = {}
        path = next(
            (n for n in self.z.namelist() if n.startswith("word/theme/") and n.endswith(".xml")),
            None,
        )
        root = self._xml(path) if path else None
        if root is None:
            return out
        for kind in ("major", "minor"):
            node = root.find(f".//{_A}fontScheme/{_A}{kind}Font")
            if node is None:
                continue
            latin, ea = node.find(f"{_A}latin"), node.find(f"{_A}ea")
            hang = next((f for f in node.findall(f"{_A}font") if f.get("script") == "Hang"), None)
            if latin is not None and latin.get("typeface"):
                out[f"{kind}:latin"] = latin.get("typeface")
            ea_face = (hang.get("typeface") if hang is not None else None) or (
                ea.get("typeface") if ea is not None else None
            )
            out[f"{kind}:ea"] = ea_face or out.get(f"{kind}:latin", "")
        return out

    def _rfont(self, fonts) -> str | None:
        """`w:rFonts` 에서 글꼴 이름 하나 — 동아시아(eastAsia) 우선, 이름이 없으면 테마 참조(…Theme 속성)를 theme1.xml 로 푼다."""
        if fonts is None:
            return None
        for attr in ("eastAsia", "ascii", "hAnsi"):
            if name := fonts.get(f"{_W}{attr}"):
                return _font(name)
            theme = fonts.get(f"{_W}{attr}Theme", "")
            if theme:
                kind = "major" if theme.startswith("major") else "minor"
                slot = "ea" if "EastAsia" in theme else "latin"
                if face := self.theme.get(f"{kind}:{slot}"):
                    return _font(face)
        return None

    def _defaults(self) -> tuple[str | None, str | None]:
        """styles.xml 의 docDefaults(rFonts·sz) — 이 값과 같은 글꼴·크기는 싣지 않는다(README 63). 문서 기본값은 편집기 기본값이
        대신하고, 본문 전체에 같은 글꼴 마크가 깔리는 걸 막는다."""
        root = self._xml("word/styles.xml")
        if root is None:
            return None, None
        # 기본 문단 줄 간격(pPrDefault spacing line) — 같은 값은 싣지 않는다(복사해 붙인 문서는 문단마다 직접 259 가 붙는다, 리뷰)
        ppr = root.find(f"{_W}docDefaults/{_W}pPrDefault/{_W}pPr/{_W}spacing")
        self.default_line = (
            _line_height(int(ppr.get(f"{_W}line")) / 240)
            if ppr is not None
            and ppr.get(f"{_W}lineRule", "auto") == "auto"
            and _digits(ppr.get(f"{_W}line"))
            else None
        )
        rpr = root.find(f"{_W}docDefaults/{_W}rPrDefault/{_W}rPr")
        if rpr is None:
            return None, None
        fonts, sz = rpr.find(f"{_W}rFonts"), rpr.find(f"{_W}sz")
        font = self._rfont(fonts)
        size = (
            _pt(int(sz.get(f"{_W}val")) / 2)
            if sz is not None and _digits(sz.get(f"{_W}val"))
            else None
        )
        return font, size

    def _heading(self, style_id: str | None) -> int | None:
        for _ in range(5):  # basedOn 사슬 — 「제목 1 기반 내 스타일」도 제목으로
            if not style_id or style_id not in self.styles:
                return None
            name, based = self.styles[style_id]
            if m := re.fullmatch(r"heading ([1-6])", name):
                return int(m.group(1))
            if name == "title":
                return 1
            style_id = based
        return None

    def _numbering(self) -> dict[str, dict[int, str]]:
        root = self._xml("word/numbering.xml")
        out: dict[str, dict[int, str]] = {}
        if root is None:
            return out
        abstract: dict[str, dict[int, str]] = {}
        for an in root.findall(f"{_W}abstractNum"):
            levels = {}
            for lvl in an.findall(f"{_W}lvl"):
                fmt = lvl.find(f"{_W}numFmt")
                levels[int(lvl.get(f"{_W}ilvl", "0"))] = (
                    fmt.get(f"{_W}val", "decimal") if fmt is not None else "decimal"
                )
            abstract[an.get(f"{_W}abstractNumId", "")] = levels
        for num in root.findall(f"{_W}num"):
            ref = num.find(f"{_W}abstractNumId")
            if ref is not None:
                out[num.get(f"{_W}numId", "")] = abstract.get(ref.get(f"{_W}val", ""), {})
        return out

    def _rels(self) -> dict[str, tuple[str, bool]]:
        root = self._xml("word/_rels/document.xml.rels")
        if root is None:
            return {}
        return {
            r.get("Id", ""): (r.get("Target", ""), r.get("TargetMode") == "External")
            for r in root.iter(f"{_REL}Relationship")
        }

    def run(self) -> tuple[str, bool]:
        body = self._xml("word/document.xml").find(f"{_W}body")
        if body is None:
            raise Empty("docx")
        self._blocks(body, self.out)
        self._close_lists(0)
        return "".join(self.out), self.cut

    # ── 블록 ──
    def _blocks(self, node, out: list[str], in_cell: bool = False) -> None:
        for el in node:
            if el.tag == f"{_W}p":
                self._para(el, out, in_cell)
            elif el.tag == f"{_W}tbl":
                if in_cell:
                    self._table(el, self._lifted)  # 편집기 셀은 문단만 받는다 — 바깥 표 뒤로 꺼낸다
                else:
                    self._close_lists(0)
                    self._table(el, out)
            elif el.tag in _CONTAINERS:
                self._blocks(el, out, in_cell)

    def _para(self, p, out: list[str], in_cell: bool) -> None:
        ppr = p.find(f"{_W}pPr")
        style = ppr.find(f"{_W}pStyle") if ppr is not None else None
        level = self._heading(style.get(f"{_W}val") if style is not None else None)
        jc = ppr.find(f"{_W}jc") if ppr is not None else None
        align = _JC.get(jc.get(f"{_W}val", "")) if jc is not None else None
        numpr = ppr.find(f"{_W}numPr") if ppr is not None else None
        inner = self._inline(p)
        extra: dict = {}
        if ppr is not None:
            sp = ppr.find(f"{_W}spacing")
            if sp is not None:
                line, rule = sp.get(f"{_W}line", ""), sp.get(f"{_W}lineRule", "auto")
                if rule == "auto" and _digits(line):
                    lh = _line_height(int(line) / 240)  # 240 = 1줄
                    extra["line_height"] = None if lh == self.default_line else lh
                extra["space_before"] = _px_from_twips(sp.get(f"{_W}before"))
                extra["space_after"] = _px_from_twips(sp.get(f"{_W}after"))
            ind = ppr.find(f"{_W}ind")
            if ind is not None:
                extra["indent"] = _px_from_twips(ind.get(f"{_W}left") or ind.get(f"{_W}start"))
        if numpr is not None and not in_cell and level is None:
            ilvl_el, num_el = numpr.find(f"{_W}ilvl"), numpr.find(f"{_W}numId")
            raw = ilvl_el.get(f"{_W}val", "0") if ilvl_el is not None else "0"
            ilvl = max(0, min(int(raw), 8)) if raw.lstrip("-").isdigit() else 0
            num_id = num_el.get(f"{_W}val", "") if num_el is not None else ""
            # numId 0 은 「번호 끄기」, numbering 에 없는 번호도 목록이 아니다(리뷰) — 보통 문단으로
            levels = self.nums.get(num_id) if num_id != "0" else None
            fmt = levels.get(ilvl, "decimal") if levels else "none"
            if fmt != "none":
                self._list_item(ilvl, "ul" if fmt == "bullet" else "ol", num_id, inner)
                return
        if not in_cell:
            self._close_lists(0)
        out.append(_block(f"h{level}" if level else "p", inner, align, extra))

    def _list_item(self, ilvl: int, tag: str, num_id: str, inner: str) -> None:
        """목록 항목 — ilvl 만큼 중첩. 깊어지면 열린 항목 안에 새 목록을, 얕아지면 그만큼 닫는다. 깊이는 한 번에 한 단계만
        (0→2 로 뛰면 빈 항목이 생긴다), 같은 깊이에서 번호(numId)나 기호↔번호가 바뀌면 새 목록(Codex 리뷰)."""
        ilvl = min(ilvl, len(self.lists))
        self._close_lists(ilvl + 1)
        if len(self.lists) == ilvl + 1 and (self.lists[-1][0], self.lists[-1][2]) != (tag, num_id):
            self._close_lists(ilvl)
        if len(self.lists) < ilvl + 1:
            self.out.append(f"<{tag}>")
            self.lists.append((tag, False, num_id))
        if self.lists[-1][1]:
            self.out.append("</li>")
        self.out.append(f"<li>{inner}")
        self.lists[-1] = (tag, True, num_id)

    def _close_lists(self, depth: int) -> None:
        while len(self.lists) > depth:
            tag, open_li, _ = self.lists.pop()
            self.out.append(("</li>" if open_li else "") + f"</{tag}>")

    def _table(self, tbl, out: list[str]) -> None:
        """행·칸을 격자에 놓는다 — gridSpan 은 colspan, vMerge 는 시작 칸에 rowspan 을 주고 이어지는 칸은 뺀다(Codex 리뷰).
        행 높이(`trHeight`, 편집기엔 최소 높이)·칸 변 테두리(`tcBorders`, 없으면 `tblBorders` 의 바깥 변/inside*)를 싣고,
        칸 안의 표는 이 표 바로 뒤에 낸다(서식 4차 — 결재란 같은 안쪽 표가 글자만 남지 않게. 자리는 제목 옆이 아니라 아래)."""
        lifted, self._lifted = self._lifted, []
        grid: list[
            tuple[list[dict], int | None]
        ] = []  # 행마다 (낼 칸들 {html, tag, colspan, rowspan, col, tcb}, 높이)
        starts: dict[int, dict] = {}  # 열 위치 → 세로 병합 시작 칸
        tblpr = tbl.find(f"{_W}tblPr")
        tbl_borders = tblpr.find(f"{_W}tblBorders") if tblpr is not None else None
        # tblBorders 만 있고 표 스타일이 없으면 적히지 않은 변은 워드가 그리지 않는다(위·아래 선만 있는 표) → none(리뷰)
        unlisted = (
            "none" if tbl_borders is not None and tblpr.find(f"{_W}tblStyle") is None else None
        )
        borderless = self._borderless(tbl)
        grid_cols = tbl.findall(f"{_W}tblGrid/{_W}gridCol")
        for tr in tbl.findall(f"{_W}tr"):
            trpr = tr.find(f"{_W}trPr")
            header = trpr is not None and trpr.find(f"{_W}tblHeader") is not None
            trh = trpr.find(f"{_W}trHeight") if trpr is not None else None
            height = _px_from_twips(trh.get(f"{_W}val")) if trh is not None else None
            cells: list[dict] = []
            next_starts: dict[
                int, dict
            ] = {}  # 이 행에서 이어진 병합만 다음 행으로(끊긴 병합은 다시 붙지 않게, Codex)
            bumped: list[dict] = []  # 이 행에서 한 줄 늘린 병합 칸 — 행이 통째로 빠지면 도로 줄인다
            if self.cells >= MAX_CELLS:
                self.cut = (
                    True  # 칸 상한 — 남은 행은 만들지 않는다(필터가 어차피 끊을 양, 비용만 든다)
                )
                break
            gb = trpr.find(f"{_W}gridBefore") if trpr is not None else None
            v = gb.get(f"{_W}val") if gb is not None else None
            before = int(v) if _digits(v) and int(v) <= MAX_SPAN else 0
            if grid_cols:
                before = min(
                    before, max(0, len(grid_cols) - 1)
                )  # 격자 열 수를 넘는 gridBefore 는 깨진 파일
            # gridBefore 만큼은 칸이 없는 자리 — 빈 칸을 내야 다음 칸이 제 열에 선다(Codex). 위에서 내려오던 병합은 여기서 끝난다.
            # gridAfter(뒤쪽 빈자리)는 열을 밀지 않으므로 내지 않는다 — 편집기 fixTables 가 채운다(리뷰)
            cells += [self._gap_cell(k, header) for k in range(before)]
            col = before
            for tc in tr.findall(f"{_W}tc"):
                tcpr = tc.find(f"{_W}tcPr")
                span_el = tcpr.find(f"{_W}gridSpan") if tcpr is not None else None
                span_val = span_el.get(f"{_W}val", "1") if span_el is not None else "1"
                colspan = int(span_val) if span_val.isdigit() and int(span_val) > 1 else 1
                vmerge = tcpr.find(f"{_W}vMerge") if tcpr is not None else None
                if (
                    vmerge is not None
                    and vmerge.get(f"{_W}val", "continue") != "restart"
                    and col in starts
                ):
                    start = starts[col]
                    start["rowspan"] += 1
                    # 병합 영역의 아래 변은 워드가 마지막 칸의 tcBorders 로 그린다(리뷰)
                    start["tcb_end"] = tcpr.find(f"{_W}tcBorders") if tcpr is not None else None
                    next_starts[col] = start
                    bumped.append(start)
                    col += colspan
                    continue  # 위 칸에 합쳐진 칸 — 내지 않는다. 열린 병합이 없는 continue 는 보통 칸으로(Codex)
                inner: list[str] = []
                self._blocks(tc, inner, in_cell=True)
                style = []
                shd = tcpr.find(f"{_W}shd") if tcpr is not None else None
                if (
                    shd is not None
                    and shd.get(f"{_W}fill", "auto") != "auto"
                    and (bg := _hex(shd.get(f"{_W}fill")))
                ):
                    style.append(f"background-color:{bg}")
                tcw = tcpr.find(f"{_W}tcW") if tcpr is not None else None
                if (
                    tcw is not None
                    and tcw.get(f"{_W}type", "dxa") == "dxa"
                    and (w := _px_from_twips(tcw.get(f"{_W}w")))
                ):
                    style.append(f"width:{w}px")
                cell = {
                    "html": "".join(inner),
                    "tag": "th" if header else "td",
                    "colspan": colspan,
                    "rowspan": 1,
                    "style": style,
                    "col": col,
                    "tcb": tcpr.find(f"{_W}tcBorders") if tcpr is not None else None,
                }
                if vmerge is not None and vmerge.get(f"{_W}val", "continue") == "restart":
                    next_starts[col] = (
                        cell  # 열린 병합 없는 continue 는 보통 칸 — 새 병합의 시작도 아니다(리뷰)
                    )
                cells.append(cell)
                col += colspan
            starts = next_starts
            self.cells += len(cells)
            if cells:
                grid.append((cells, height))
            else:
                # 이어지는 칸뿐인 행은 출력에서 사라진다 — 그 행을 세던 병합도 한 줄 줄여야 아래 행을 덮지 않는다(Codex)
                for start in bumped:
                    start["rowspan"] -= 1
        ncols = len(grid_cols) or max(
            (c["col"] + c["colspan"] for cells, _ in grid for c in cells), default=0
        )
        rows: list[str] = []
        for r, (cells, height) in enumerate(grid):
            html_cells = []
            for c in cells:
                outer = {
                    "top": r == 0,
                    "bottom": r + c["rowspan"] >= len(grid),
                    "left": c["col"] == 0,
                    "right": c["col"] + c["colspan"] >= ncols,
                }
                sides = {
                    side: "none"  # gridBefore 빈자리엔 칸이 없어 워드가 선을 안 그린다(리뷰)
                    if c.get("gap")
                    else self._border(
                        c["tcb_end"] if side == "bottom" and "tcb_end" in c else c["tcb"],
                        tbl_borders,
                        side,
                        is_outer,
                    )
                    or unlisted
                    for side, is_outer in outer.items()
                }
                style = ";".join(c["style"] + _cell_border_style(sides, borderless))
                attrs = (
                    (f' colspan="{c["colspan"]}"' if c["colspan"] > 1 else "")
                    + (f' rowspan="{c["rowspan"]}"' if c["rowspan"] > 1 else "")
                    + (f' style="{style}"' if style else "")
                )
                html_cells.append(f"<{c['tag']}{attrs}>{c['html']}</{c['tag']}>")
            tr_style = f' style="height:{height}px"' if height else ""
            rows.append(f"<tr{tr_style}>{''.join(html_cells)}</tr>")
        borders = ' data-borders="none"' if borderless else ""
        out.append(f"<table{borders}>{''.join(rows)}</table>")
        out.extend(self._lifted)
        self._lifted = lifted

    @staticmethod
    def _gap_cell(col: int, header: bool) -> dict:
        """gridBefore/gridAfter 로 비어 있는 자리의 빈 칸."""
        return {
            "html": "<p></p>",
            "tag": "th" if header else "td",
            "colspan": 1,
            "rowspan": 1,
            "style": [],
            "col": col,
            "tcb": None,
            "gap": True,
        }

    @staticmethod
    def _border(tcb, tbl_borders, side: str, is_outer: bool) -> str | None:
        """칸 한 변 — 칸 자신(tcBorders)이 우선, 없으면 표(tblBorders)의 바깥 변 또는 안쪽 선(insideH·insideV)."""
        el = None
        for name in _SIDE_NAMES[side]:
            if tcb is not None and (el := tcb.find(f"{_W}{name}")) is not None:
                break
        if el is None and tbl_borders is not None:
            names = (
                _SIDE_NAMES[side]
                if is_outer
                else (("insideH",) if side in ("top", "bottom") else ("insideV",))
            )
            for name in names:
                if (el := tbl_borders.find(f"{_W}{name}")) is not None:
                    break
        if el is None:
            return None
        sz = el.get(f"{_W}sz", "")
        color = el.get(f"{_W}color")
        return _border_css(
            el.get(f"{_W}val"),
            int(sz) / 8 * 96 / 72 if _digits(sz) else None,  # sz 는 1/8pt
            None if color in (None, "auto") else color,
        )

    def _borderless(self, tbl) -> bool:
        """테두리 없는 표 — 네 변(top·bottom·left/start·right/end)이 모두 적혀 있고 전부 none/nil 이거나, tblBorders 도 tblStyle 도
        없을 때(워드는 그러면 선을 안 그린다). 일부 변만 none 이고 tblStyle 이 있으면 스타일이 나머지를 그리므로 테두리 있음(리뷰)."""
        tblpr = tbl.find(f"{_W}tblPr")
        borders = tblpr.find(f"{_W}tblBorders") if tblpr is not None else None
        if borders is None:
            return tblpr is None or tblpr.find(f"{_W}tblStyle") is None
        vals: dict[str, str] = {}
        for b in borders:
            side = b.tag.removeprefix(_W)
            side = {"start": "left", "end": "right"}.get(side, side)
            vals[side] = b.get(f"{_W}val", "none")
        sides = ("top", "bottom", "left", "right")
        if not all(side in vals for side in sides):
            return tblpr.find(f"{_W}tblStyle") is None and all(
                v in ("none", "nil") for v in vals.values()
            )
        return all(vals[side] in ("none", "nil") for side in sides)

    # ── 인라인 ──
    def _inline(self, node, href: str | None = None) -> str:
        parts: list[str] = []
        for el in node:
            if el.tag == f"{_W}r":
                parts.append(self._run(el, href))
            elif el.tag == f"{_W}hyperlink":
                rid = el.get(f"{_R}id")
                target, external = self.rels.get(rid or "", ("", False))
                parts.append(self._inline(el, target if external else href))
            elif el.tag in _CONTAINERS:
                parts.append(self._inline(el, href))
            # w:del(변경 추적 삭제)·pPr·bookmark 등은 건너뛴다
        return "".join(parts)

    def _run(self, r, href: str | None) -> str:
        rpr = r.find(f"{_W}rPr")
        text: list[str] = []
        for el in r:
            if el.tag == f"{_W}t":
                text.append(html.escape(el.text or "", quote=False))
            elif el.tag == f"{_W}tab":
                text.append(" ")
            elif el.tag in (f"{_W}br", f"{_W}cr"):
                text.append("<br>")
            elif el.tag == f"{_W}drawing":
                text.append(self._drawing(el))
            elif el.tag == f"{_W}pict":
                img = el.find(f".//{_V}imagedata")
                if img is not None:
                    text.append(self._image(img.get(f"{_R}id"), None))
        color = bg = font = size = None
        if rpr is not None:
            font = self._rfont(rpr.find(f"{_W}rFonts"))
            sz = rpr.find(f"{_W}sz")
            if sz is not None and _digits(sz.get(f"{_W}val")):
                size = _pt(int(sz.get(f"{_W}val")) / 2)  # 반포인트
            if font == self.default_font:
                font = None
            if size == self.default_size:
                size = None
            c = rpr.find(f"{_W}color")
            color = (
                _hex(c.get(f"{_W}val")) if c is not None and c.get(f"{_W}val") != "auto" else None
            )
            hl = rpr.find(f"{_W}highlight")
            shd = rpr.find(f"{_W}shd")
            if hl is not None:
                bg = _HIGHLIGHT.get(hl.get(f"{_W}val", ""))
            elif shd is not None and shd.get(f"{_W}fill", "auto") != "auto":
                bg = _hex(shd.get(f"{_W}fill"))
        return _wrap(
            "".join(text),
            bold=_on(rpr, "b"),
            italic=_on(rpr, "i"),
            underline=_on(rpr, "u"),
            strike=_on(rpr, "strike") or _on(rpr, "dstrike"),
            color=color,
            bg=bg,
            href=href,
            font=font,
            size=size,
        )

    def _drawing(self, drawing) -> str:
        blip = drawing.find(f".//{_A}blip")
        if blip is None:
            return ""
        extent = drawing.find(f".//{_WP}extent")
        width = None
        if extent is not None and extent.get("cx", "").isdigit():
            width = int(extent.get("cx")) // _EMU_PER_PX
        return self._image(blip.get(f"{_R}embed"), width)

    def _image(self, rid: str | None, width: int | None) -> str:
        target, external = self.rels.get(rid or "", ("", True))
        if external or not target:
            return ""
        # "media/image1.png" → "word/media/image1.png", 절대 경로 "/word/media/…" 는 그대로(리뷰). zip 이름만 조회하니 밖으로 못 나간다
        path = posixpath.normpath(
            target.lstrip("/") if target.startswith("/") else posixpath.join("word", target)
        )
        return _image_tag(self.z, path, self.images, width, self.seen)


# ── xlsx ─────────────────────────────────────────────────────────────────────────


def _cell_html(cell, default_font=None) -> tuple[str, str | None]:
    """(셀 값 HTML, 셀 배경색). 글자 서식은 굵게·기울임·밑줄·취소선·글자색·글꼴·크기, 채우기는 셀 배경(계약 backgroundColor).
    read_only 의 EmptyCell 은 서식이 없다."""
    value = cell.value
    text = html.escape("" if value is None else str(value))
    font = getattr(cell, "font", None)
    fill = getattr(cell, "fill", None)
    bg = None
    if fill is not None and fill.fill_type == "solid" and isinstance(fill.fgColor.rgb, str):
        bg = _hex(fill.fgColor.rgb)
        if bg in ("#ffffff", "#000000"):
            bg = None
    if not text or font is None:
        return text, bg
    color = (
        _hex(font.color.rgb) if font.color is not None and isinstance(font.color.rgb, str) else None
    )
    if color == "#000000":
        color = None
    return _wrap(
        text,
        bold=bool(font.b),
        italic=bool(font.i),
        underline=bool(font.u),
        strike=bool(font.strike),
        color=color,
        font=None
        if default_font is not None and font.name == default_font.name
        else _font(font.name),
        size=None
        if font.sz is None or (default_font is not None and font.sz == default_font.sz)
        else _pt(float(font.sz)),
    ), bg


_COL_RE = re.compile(rb"<col\b([^>]*?)/?>")
_COL_ATTR_RE = re.compile(rb'(min|max|width|hidden)="([^"]*)"')
_COLS_HEAD_BYTES = 256 * 1024  # <cols> 는 <sheetData> 앞에 있다 — 시트 XML 의 앞부분만 읽는다
MAX_XLSX_COLS = 16384  # 엑셀 열 상한(XFD)


def _xlsx_col_widths(z: zipfile.ZipFile) -> list[dict[int, int]]:
    """워크시트 순서대로(차트시트는 건너뛴다 — wb.worksheets 와 같은 순서, 리뷰) {열 번호(1부터): px}. workbook.xml 의 시트 순서 →
    rels → sheetN.xml 앞부분의 <cols>. 엑셀 열 너비(글자 수)는 여백 포함 값이라 ×7 이 화면 px 에 가깝다(9.14 → 64px, 리뷰).
    시트 XML 은 수십 MB 일 수 있어 `_parse_xml`(2MB 상한)로 읽지 않는다 — 앞 256KB 만 읽어 `<sheetData` 앞에서 자르고 `<col>` 을
    정규식으로 꺼낸다(리뷰: 10MB 시트가 통째로 거절됐고, `<col min=1 max=1024>` 4.8만 개가 47초 걸렸다). 못 읽으면 {} —
    너비는 있으면 좋은 것이지 거절 사유가 아니다. read_only 워크시트는 column_dimensions 를 안 준다."""
    _XL = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
    try:
        wb_root = _parse_xml(z, "xl/workbook.xml")
        rels_root = _parse_xml(z, "xl/_rels/workbook.xml.rels")
    except (TooLarge, Unsupported):
        return []
    if wb_root is None or rels_root is None:
        return []
    rels = {r.get("Id", ""): r.get("Target", "") for r in rels_root.iter(f"{_REL}Relationship")}
    out: list[dict[int, int]] = []
    for sh in wb_root.iter(f"{_XL}sheet"):
        target = rels.get(sh.get(f"{_R}id", ""), "")
        if "worksheets/" not in target:
            continue  # 차트시트 등 — openpyxl 의 wb.worksheets 에도 없다
        path = posixpath.normpath(
            target.lstrip("/") if target.startswith("/") else posixpath.join("xl", target)
        )
        widths: dict[int, int] = {}
        if path in z.namelist():
            with z.open(path) as f:
                head = f.read(_COLS_HEAD_BYTES)
            head = head.split(b"<sheetData", 1)[0]
            for m in _COL_RE.finditer(head):
                attrs = dict(_COL_ATTR_RE.findall(m.group(1)))
                if attrs.get(b"hidden") in (b"1", b"true"):
                    continue
                try:
                    lo = int(attrs.get(b"min", b"0"))
                    hi = min(int(attrs.get(b"max", b"0")), MAX_XLSX_COLS)
                    w = float(attrs.get(b"width", b"0"))
                except ValueError:
                    continue
                if not (w > 0 and 0 < lo <= hi):
                    continue
                for c in range(lo, hi + 1):
                    if len(widths) >= MAX_XLSX_COLS:
                        break
                    widths.setdefault(c, min(4000, round(w * 7)))
        out.append(widths)
    return out


def _cell_align(cell) -> str | None:
    al = getattr(cell, "alignment", None)
    h = al.horizontal if al is not None else None
    return {
        "center": "center",
        "right": "right",
        "justify": "justify",
        "centerContinuous": "center",
    }.get(h or "")


def _xlsx(data: bytes) -> tuple[str, bool]:
    """시트마다 「h2 시트명」 + 표. 첫 행은 머리글(th). 빈 행은 건너뛰고 뒤쪽 빈 칸은 잘라 표가 넓어지지 않게(셀 수도
    자른 뒤로 센다 — read_only 는 dimension 이 `A1:AMJ…` 인 파일에서 행마다 1024칸을 돌려준다, 리뷰), 행은 가장 긴
    행까지 빈 셀로 채운다(들쭉날쭉하면 편집기가 열 때 머리글을 오른쪽으로 민다, 리뷰). 셀 서식은 `_cell_html`.
    셀 수(MAX_XLSX_CELLS)나 결과 크기에서 멈추면 끊었다고 돌려준다.
    ponytail: 병합 셀은 풀어진 채(첫 칸에만 값), 날짜는 str() 그대로. 필요해지면 ws.merged_cells 와 number_format.
    """
    with _zip(data) as z:
        # openpyxl 은 styles·sharedStrings 를 통째로 객체화한다 — 1.86MB 의 <xf> 3만 개가 23MB 였다(Codex). 본문 XML 과 같은 상한
        for member in ("xl/styles.xml", "xl/sharedStrings.xml", "xl/workbook.xml"):
            if member in z.namelist() and z.getinfo(member).file_size > MAX_XML_BYTES:
                raise TooLarge(member)
    with _zip(data) as z:
        col_widths = _xlsx_col_widths(z)
    wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    fonts = getattr(wb, "_fonts", None)
    default_font = (
        fonts[0] if fonts else None
    )  # 통합 문서 기본 글꼴(Normal) — 같은 값은 싣지 않는다(README 63)
    parts: list[str] = []
    cells = visited = size = 0

    def flush(title: str, rows: list[tuple], widths: dict[int, int]) -> None:
        width = max((len(r) for r in rows), default=0)
        parts.append(f"<h2>{html.escape(title)}</h2><table>")
        for i, row in enumerate(rows):
            tag = "th" if i == 0 else "td"
            tds = []
            for j, c in enumerate(row, start=1):
                inner, bg = _cell_html(c, default_font)
                style = []
                if bg:
                    style.append(f"background-color:{bg}")
                if i == 0 and widths.get(
                    j
                ):  # 열 너비는 첫 행에만 — 편집기(colwidth)는 첫 행 값을 쓴다
                    style.append(f"width:{widths[j]}px")
                attr = f' style="{";".join(style)}"' if style else ""
                tds.append(f"<{tag}{attr}>{_block('p', inner, _cell_align(c))}</{tag}>")
            tds += [f"<{tag}><p></p></{tag}>"] * (width - len(row))
            parts.append(f"<tr>{''.join(tds)}</tr>")
        parts.append("</table>")

    try:
        if any((ws.max_row or 0) * (ws.max_column or 0) > MAX_XLSX_AREA for ws in wb.worksheets):
            raise TooLarge("xlsx")  # 선언된 범위(dimension) 기준 — 돌기 전에 거절
        for sheet_no, ws in enumerate(wb.worksheets):
            widths = col_widths[sheet_no] if sheet_no < len(col_widths) else {}
            rows: list[tuple] = []
            for row in ws.iter_rows():
                visited += len(row)
                n = len(row)
                while n and row[n - 1].value is None:  # 뒤쪽 빈 칸 — 역방향으로 한 번만 자른다
                    n -= 1
                row = row[:n]
                if visited > MAX_XLSX_VISITED:
                    flush(ws.title, rows, widths)
                    return "".join(parts), True
                if not row:
                    continue
                cells += len(row)
                if cells > MAX_XLSX_CELLS or size > 2 * MAX_SEED_COST:
                    flush(ws.title, rows, widths)
                    return "".join(parts), True
                rows.append(row)
                size += (
                    sum(len(str(c.value)) for c in row if c.value is not None)
                    + len(row) * 2 * TAG_COST
                )
            flush(ws.title, rows, widths)
    finally:
        wb.close()
    return "".join(parts), False


# ── hwpx ─────────────────────────────────────────────────────────────────────────

_HH = "{http://www.hancom.co.kr/hwpml/2011/head}"
_HC = "{http://www.hancom.co.kr/hwpml/2011/core}"
_OPF = "{http://www.idpf.org/2007/opf/}"
_HWPUNIT_PER_PX = 75  # 7200/inch ÷ 96px/inch


class _Hwpx:
    """섹션 순서대로 최상위 문단(hs:sec 의 직속 hp:p). header.xml 의 글자 모양(charPr: 굵게·기울임·밑줄·취소선·textColor·
    shadeColor)과 문단 모양(paraPr: align, heading OUTLINE level → h1~h6)을 id 로 대조한다. 문단 안 표는
    hp:tbl/hp:tr/hp:tc/hp:subList/hp:p 를 같은 규칙으로(셀 병합은 hp:cellSpan), 그림은 hp:pic/hc:img binaryItemIDRef →
    content.hpf 매니페스트 → BinData. run 순서대로 글·표·그림을 낸다(「글 → 표 → 글」 유지).
    ponytail: 하이퍼링크(필드 컨트롤)·글머리표(목록)는 1차 제외 — 글머리는 글자로 남는다."""

    def __init__(self, z: zipfile.ZipFile, images: list[tuple[bytes, str]]) -> None:
        self.z = z
        self.images = images
        self.sections = hwpx_sections(z)
        if sum(z.getinfo(s).file_size for s in self.sections) > MAX_XML_BYTES:
            raise TooLarge("hwpx")
        self.char: dict[str, dict] = {}
        self.para: dict[str, dict] = {}
        self.para_extra: dict[str, dict] = {}  # 문단 모양 → 줄 간격·여백(계약 속성)
        self.fills: dict[str, dict] = {}  # borderFill id → {bg, borderless, sides}
        self.seen: dict[str, int] = {}
        self._lifted: list[str] = []  # 칸 안의 표 — 바깥 표 뒤에 낸다(서식 4차)
        self._depth = 0  # 열린 표 깊이
        self._header()
        self._drop_default_para()
        self.manifest = self._manifest()

    def _xml(self, path: str):
        return _parse_xml(self.z, path)

    def _header(self) -> None:
        root = self._xml("Contents/header.xml")
        if root is None:
            return
        faces: dict[str, str] = {}  # 한글 글꼴 id → 이름(fontface lang=HANGUL)
        for ff in root.iter(f"{_HH}fontface"):
            if ff.get("lang", "HANGUL").upper() == "HANGUL":
                for f in ff.findall(f"{_HH}font"):
                    faces[f.get("id", "")] = f.get("face", "")
        for bf in root.iter(f"{_HH}borderFill"):
            brush = bf.find(f".//{_HC}winBrush")
            if brush is None:
                brush = bf.find(f".//{_HH}winBrush")
            bg = _hex(brush.get("faceColor")) if brush is not None else None
            sides = {
                side: bf.find(f"{_HH}{side}Border") for side in ("top", "right", "bottom", "left")
            }
            self.fills[bf.get("id", "")] = {
                "bg": None if bg in ("#ffffff", None) else bg,
                "borderless": all(
                    sd is None or sd.get("type", "NONE").upper() == "NONE" for sd in sides.values()
                ),
                "sides": {
                    side: _border_css(sd.get("type"), _px_from_mm(sd.get("width")), sd.get("color"))
                    if sd is not None
                    else None
                    for side, sd in sides.items()
                },
            }
        for cp in root.iter(f"{_HH}charPr"):
            u = cp.find(f"{_HH}underline")
            so = cp.find(f"{_HH}strikeout")
            shade = cp.get("shadeColor", "none")
            self.char[cp.get("id", "")] = {
                "bold": cp.find(f"{_HH}bold") is not None,
                "italic": cp.find(f"{_HH}italic") is not None,
                "underline": u is not None and u.get("type", "NONE").upper() != "NONE",
                "strike": so is not None and so.get("shape", "NONE").upper() != "NONE",
                "color": None
                if cp.get("textColor", "#000000") in ("#000000", "none")
                else _hex(cp.get("textColor")),
                "bg": None if shade == "none" else _hex(shade),
                "font": _font(
                    faces.get(
                        cp.find(f"{_HH}fontRef").get("hangul", "")
                        if cp.find(f"{_HH}fontRef") is not None
                        else ""
                    )
                ),
                "size": _pt(int(cp.get("height")) / 100)
                if _digits(cp.get("height"))
                else None,  # 1/100 pt
            }
        base = self.char.get(
            "0", {}
        )  # 한글의 기본 글자 모양(id 0) — 같은 글꼴·크기는 싣지 않는다(README 63)
        base_font, base_size = (
            base.get("font"),
            base.get("size"),
        )  # 같은 dict 라 루프 전에 값을 떼어 둔다(리뷰)
        for cp in self.char.values():
            if cp.get("font") == base_font:
                cp["font"] = None
            if cp.get("size") == base_size:
                cp["size"] = None
        for pp in root.iter(f"{_HH}paraPr"):
            al = pp.find(f"{_HH}align")
            hd = pp.find(f"{_HH}heading")
            level = None
            if (
                hd is not None
                and hd.get("type", "NONE").upper() == "OUTLINE"
                and hd.get("level", "").isdigit()
            ):
                level = min(int(hd.get("level")) + 1, 6)
            # 한글이 저장한 파일은 여백·줄 간격을 hp:switch/hp:default 아래에 두고 margin 자식은 hc: 네임스페이스다(리뷰)
            scope = pp.find(f"{_HP}switch/{_HP}default")
            if scope is None:
                scope = pp
            ls = scope.find(f"{_HH}lineSpacing")
            margin = scope.find(f"{_HH}margin")
            extra: dict = {}
            if (
                ls is not None
                and ls.get("type", "").upper() == "PERCENT"
                and _digits(ls.get("value"))
            ):
                extra["line_height"] = _line_height(int(ls.get("value")) / 100)
            if margin is not None:
                for child, key in (
                    ("left", "indent"),
                    ("prev", "space_before"),
                    ("next", "space_after"),
                ):
                    m = margin.find(f"{_HC}{child}")
                    if m is None:
                        m = margin.find(f"{_HH}{child}")
                    if m is not None:
                        extra[key] = _px_from_hwpunit(m.get("value"))
            self.para_extra[pp.get("id", "")] = extra
            self.para[pp.get("id", "")] = {
                "align": {
                    "CENTER": "center",
                    "RIGHT": "right",
                    "JUSTIFY": "justify",
                    "DISTRIBUTE": "justify",
                }.get((al.get("horizontal", "") if al is not None else "").upper()),
                "level": level,
            }

    def _drop_default_para(self) -> None:
        base = dict(self.para_extra.get("0", {}))  # 값을 떼어 둔다(같은 dict 함정)
        for extra in self.para_extra.values():
            for key, value in base.items():
                if value is not None and extra.get(key) == value:
                    extra[key] = None

    def _manifest(self) -> dict[str, str]:
        root = self._xml("Contents/content.hpf")
        if root is None:
            return {}
        return {it.get("id", ""): it.get("href", "") for it in root.iter(f"{_OPF}item")}

    def run(self) -> tuple[str, bool]:
        parts: list[str] = []
        for sec in self.sections:
            root = self._xml(sec)
            for p in root.findall(f"{_HP}p"):
                parts.append(self._block(p))
        return "".join(parts), False

    def _block(self, p) -> str:
        """run 순서대로 — 「글 → 표 → 글」이 「글글 → 표」가 되지 않게(리뷰). 표 앞뒤 글은 각각 문단."""
        pr = self.para.get(p.get("paraPrIDRef", ""), {})
        tag = f"h{pr['level']}" if pr.get("level") else "p"
        out: list[str] = []
        text: list[str] = []

        extra = self.para_extra.get(p.get("paraPrIDRef", ""), {})

        def flush() -> None:
            if line := "".join(text).strip():
                out.append(_block(tag, line, pr.get("align"), extra))
            text.clear()

        for run in p.findall(f"{_HP}run"):
            marks = self.char.get(run.get("charPrIDRef", ""), {})
            for el in run:
                name = el.tag.removeprefix(_HP)
                if name == "t":
                    text.append(_wrap(self._text(el), **marks))
                elif name == "tbl":
                    flush()
                    (self._lifted if self._depth else out).append(
                        self._table(el)
                    )  # 칸 안의 표는 바깥 표 뒤로
                elif name == "pic":
                    flush()
                    out.append(self._pic(el))
        flush()
        if not out:
            out.append(
                "<p></p>"
            )  # 글자·표·그림이 없는 문단 — 일부러 띄운 빈 줄은 남긴다(Codex 리뷰)
        return "".join(out)

    def _text(self, t) -> str:
        parts = [html.escape(t.text or "", quote=False)]
        for child in t:
            tag = child.tag.removeprefix(_HP)
            parts.append(" " if tag == "tab" else "<br>" if tag == "lineBreak" else "")
            parts.append(html.escape(child.tail or "", quote=False))
        return "".join(parts)

    def _table(self, tbl) -> str:
        """행 높이는 그 행 칸들의 `cellSz height` 중 가장 큰 것(세로 병합 칸 제외), 칸 변 테두리는 칸의 borderFill 에서.
        칸 안의 표는 이 표 바로 뒤에 낸다(docx 와 같은 이유)."""
        lifted, self._lifted = self._lifted, []
        self._depth += 1
        # 표 자체와 모든 셀의 borderFill 이 다 선 없음일 때만 — 한글은 셀 쪽이 선을 그리는 경우가 있다(리뷰, 실제 파일 미확인)
        refs = [tbl.get("borderFillIDRef", "")] + [
            tc.get("borderFillIDRef", "") for tc in tbl.findall(f"{_HP}tr/{_HP}tc")
        ]
        borderless = all(self.fills.get(r, {}).get("borderless") for r in refs)
        rows: list[str] = []
        for tr in tbl.findall(f"{_HP}tr"):
            cells: list[str] = []
            height = 0
            for tc in tr.findall(f"{_HP}tc"):
                inner = (
                    "".join(self._block(p) for p in tc.findall(f"{_HP}subList/{_HP}p")) or "<p></p>"
                )
                span = tc.find(f"{_HP}cellSpan")
                attrs = ""
                if span is not None:
                    for src, dst in (("colSpan", "colspan"), ("rowSpan", "rowspan")):
                        if (v := span.get(src, "1")) != "1":
                            attrs += f' {dst}="{html.escape(v, quote=True)}"'  # 상한은 필터가 본다
                style = []
                fill = self.fills.get(tc.get("borderFillIDRef", ""), {})
                if fill.get("bg"):
                    style.append(f"background-color:{fill['bg']}")
                sz = tc.find(f"{_HP}cellSz")
                if sz is not None and (w := _px_from_hwpunit(sz.get("width"))):
                    style.append(f"width:{w}px")
                if (
                    sz is not None
                    and (span is None or span.get("rowSpan", "1") == "1")
                    and (h := _px_from_hwpunit(sz.get("height")))
                ):
                    height = max(height, h)
                style += _cell_border_style(fill.get("sides", {}), borderless)
                if style:
                    attrs += f' style="{";".join(style)}"'
                cells.append(f"<td{attrs}>{inner}</td>")
            tr_style = f' style="height:{height}px"' if height else ""
            rows.append(f"<tr{tr_style}>{''.join(cells)}</tr>")
        self._depth -= 1
        borders = ' data-borders="none"' if borderless else ""
        table = f"<table{borders}>{''.join(rows)}</table>" + "".join(self._lifted)
        self._lifted = lifted
        return table

    def _pic(self, pic) -> str:
        img = pic.find(f".//{_HC}img")
        if img is None:
            return ""
        href = self.manifest.get(img.get("binaryItemIDRef", ""), "")
        if not href:
            ref = img.get("binaryItemIDRef", "")
            href = next((n for n in self.z.namelist() if n.startswith(f"BinData/{ref}.")), "")
        path = href if href in self.z.namelist() else f"Contents/{href}"
        sz = pic.find(f"{_HP}sz")
        width = (
            int(sz.get("width")) // _HWPUNIT_PER_PX
            if sz is not None and sz.get("width", "").isdigit()
            else None
        )
        return _image_tag(self.z, path, self.images, width, self.seen)
