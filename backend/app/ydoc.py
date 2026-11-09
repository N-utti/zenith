"""편집기용 HTML → Y.Doc(README 61) — 서버가 문서 본문을 직접 심는다.

convert.to_html 이 만든 **허용 태그 HTML**(convert.ALLOWED 안의 태그만, 속성은 colspan·rowspan·href)을 y-prosemirror 가
만드는 것과 같은 모양의 Y.Doc 으로 옮긴다: 노드 = `XmlElement(노드 이름, 속성)`, 글자 = `XmlText`, 마크 = 글자 구간의
format 속성(`{"bold": {}}`, `{"link": {"href": …}}`), 문서 루트 = XmlFragment "default", 제목 = Map "meta" 의 title.
노드 이름·속성은 프론트 편집기 스키마(frontend/src/features/docs/editorExtensions.ts: StarterKit·Table·Underline·Link)와
맞아야 한다 — 어긋난 노드는 Tiptap 이 통째로 버린다. 그래서 받는 HTML 은 convert 의 필터를 지난 것만이고,
여기서도 모르는 태그는 벗긴다. 검증은 프론트 스키마로 실제 Y.Doc 을 읽어 봤다(PR 본문).

ProseMirror 내용 규칙 때문에 글자를 감쌀 문단을 만들어 넣는 곳: listItem(paragraph block*)·tableCell/tableHeader(paragraph+)·
blockquote(block+)·루트. codeBlock 은 글자를 바로 담는다(안의 code 태그는 벗김). gc 는 끈다(realtime/yjs.py 와 같게).
"""

import re
from html.parser import HTMLParser

from pycrdt import Doc, Map, XmlElement, XmlFragment, XmlText

# HTML 태그 → ProseMirror 노드 이름. 값이 None 이면 태그만 벗긴다(thead·tbody).
NODES: dict[str, str | None] = {
    "p": "paragraph",
    "h1": "heading",
    "h2": "heading",
    "h3": "heading",
    "h4": "heading",
    "h5": "heading",
    "h6": "heading",
    "ul": "bulletList",
    "ol": "orderedList",
    "li": "listItem",
    "table": "table",
    "tr": "tableRow",
    "td": "tableCell",
    "th": "tableHeader",
    "pre": "codeBlock",
    "blockquote": "blockquote",
    "hr": "horizontalRule",
    "br": "hardBreak",
    "thead": None,
    "tbody": None,
}
# HTML 태그 → 마크 이름(글자 구간 format). code 는 pre 안에서는 벗긴다.
MARKS = {
    "strong": "bold",
    "em": "italic",
    "u": "underline",
    "s": "strike",
    "code": "code",
    "a": "link",
}
# 글자가 바로 들어갈 수 없어 문단으로 감싸는 노드(ProseMirror content 규칙)
_WRAP_TEXT = {"listItem", "tableCell", "tableHeader", "blockquote", None}
_LINK_ATTRS = {
    "target": "_blank",
    "rel": "noopener noreferrer nofollow",
}  # 프론트 Link 확장의 HTMLAttributes 와 같게

# 닫을 때 비어 있으면 지우는 노드(content 가 `x+` 라 빈 채로는 스키마 위반 — xlsx 빈 시트의 `<table></table>` 등)
_EMPTY_REMOVE = {"table", "tableRow", "bulletList", "orderedList", "blockquote"}
# 첫 자식이 문단이어야 하는 노드(listItem `paragraph block*`, 셀 `paragraph+`)
_NEED_PARAGRAPH = {"listItem", "tableCell", "tableHeader"}
_LISTS = {"bulletList", "orderedList"}
_TEXT_PARENTS = {"paragraph", "heading", "codeBlock"}  # 글자(와 hardBreak)를 바로 담는 노드
_CELLS = {"tableCell", "tableHeader"}


def build(html: str, title: str, file: tuple[str, str, int] | None = None) -> bytes:
    """Y.Doc 전체 상태(업데이트 바이트). realtime/yjs.py 가 그대로 `apply_update` 해 방을 연다.
    `file`=(url, 이름, 크기)면 본문 끝에 원본 파일 칩(fileChip, frontend FileChip.ts) 문단을 붙인다."""
    doc = Doc(skip_gc=True)
    doc.get("meta", type=Map)["title"] = title
    root = doc.get("default", type=XmlFragment)
    b = _Builder(root)
    b.feed(html)
    b.close()
    if file is not None:
        url, name, size = file
        p = XmlElement("paragraph")
        root.children.append(p)
        p.children.append(XmlElement("fileChip", {"src": url, "name": name, "size": size}))
    return doc.get_update()


def plain_text(update: bytes) -> str:
    """검색용 평문 — realtime/yjs.py 의 `_plain_text` 와 같은 규칙(XmlText 만 모은다)."""
    from app.realtime.yjs import _plain_text

    doc = Doc()
    doc.apply_update(update)
    return _plain_text(doc.get("default", type=XmlFragment))


class _Builder(HTMLParser):
    def __init__(self, root: XmlFragment) -> None:
        super().__init__(convert_charrefs=True)
        self.stack: list[tuple[str | None, XmlFragment | XmlElement]] = [
            (None, root)
        ]  # (노드 이름, 요소)
        self.marks: list[tuple[str, dict]] = []  # 열린 마크(안쪽이 뒤)
        self.text: XmlText | None = None  # 지금 이어 쓰는 글자 노드
        self.implicit = 0  # 글자를 감싸려고 우리가 연 문단 — 블록이 열리거나 부모가 닫히면 닫는다
        self.unwrapped: list[
            str
        ] = []  # 셀 안의 블록처럼 노드로 만들지 않고 벗긴 태그 — 끝 태그를 짝 맞춰 삼킨다

    # ── 노드 ──
    def _parent(self) -> tuple[str | None, XmlFragment | XmlElement]:
        return self.stack[-1]

    def _open(self, name: str, attrs: dict | None = None) -> None:
        el = XmlElement(name, attrs or {})
        self._parent()[1].children.append(el)
        self.stack.append((name, el))
        self.text = None

    def _pop(self) -> str | None:
        """노드 하나를 닫으며 스키마 규칙을 맞춘다: 빈 컨테이너는 지우고, 항목·셀은 첫 자식을 문단으로."""
        name, el = self.stack.pop()
        if name == "paragraph" and self.implicit:
            self.implicit -= 1
        parent = self.stack[-1][1]
        if name in _EMPTY_REMOVE and len(el.children) == 0:
            del parent.children[len(parent.children) - 1]  # 우리가 마지막에 붙인 노드
        elif name in _NEED_PARAGRAPH:
            first = el.children[0] if len(el.children) else None
            if not isinstance(first, XmlElement) or first.tag != "paragraph":
                el.children.insert(0, XmlElement("paragraph"))
        self.text = None
        return name

    def _close_implicit(self) -> None:
        if self.implicit and self.stack[-1][0] == "paragraph":
            self._pop()

    def _unwrap(self, name: str) -> None:
        """노드로 만들지 않는다 — 글자는 문단으로 남고, 짝 끝 태그는 삼킨다."""
        if name != "horizontalRule":
            self.unwrapped.append(name)

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        a = {k: v for k, v in attrs if v is not None}
        if tag in MARKS:
            if tag == "code" and self.stack[-1][0] == "codeBlock":
                return
            mark_attrs: dict = {}
            if tag == "a":
                if not a.get("href"):
                    return
                mark_attrs = {"href": a["href"], **_LINK_ATTRS}
            self.marks.append((MARKS[tag], mark_attrs))
            return
        if tag not in NODES:
            return  # 모르는 태그 — 벗기고 글자만
        name = NODES[tag]
        if name is None:
            return
        if name == "hardBreak":
            if self.stack[-1][0] == "codeBlock":
                self.handle_data("\n")  # 코드블록 안은 글자만 — 줄바꿈은 글자로
                return
            self._ensure_text_parent()
            if self.stack[-1][0] not in _TEXT_PARENTS:
                return  # 표·목록 구조 사이의 br 은 버린다 — 거기 붙이면 그 노드가 통째로 버려진다(리뷰)
            self._parent()[1].children.append(XmlElement("hardBreak"))
            self.text = None
            return
        self._close_implicit()
        if (
            self.stack[-1][0] in _TEXT_PARENTS
            and self.stack[-1][0] != "paragraph"
            or (self.stack[-1][0] == "paragraph" and name != "paragraph")
        ):
            self._pop()  # 문단·제목·코드블록 안에 블록이 오면 브라우저처럼 부모를 먼저 닫는다(리뷰)
        parent = self.stack[-1][0]
        if name == "paragraph" and parent == "paragraph":
            return  # 문단 안 문단 — 벗긴다(끝 태그는 스택에 없어 무시된다)
        # 자리에 맞지 않는 구조 노드는 벗긴다(스키마: table>tableRow>cell>paragraph+, list>listItem>paragraph block*)
        if parent == "table" and name != "tableRow":
            return self._unwrap(name)  # 표 바로 아래엔 행만
        if parent == "tableRow" and name not in _CELLS:
            return self._unwrap(name)
        if parent in _CELLS and name != "paragraph":
            return self._unwrap(name)  # 셀 안은 문단만 — 셀 안의 표·목록·제목은 글자만 문단으로
        if name == "tableRow" and parent != "table":
            return self._unwrap(name)
        if name in _CELLS and parent != "tableRow":
            return self._unwrap(name)
        if name == "listItem" and parent not in _LISTS:
            return self._unwrap(name)  # 목록 밖의 항목 — 글자만 문단으로
        if parent in _LISTS and name != "listItem":
            # 목록 바로 아래 글/블록 — 항목으로 감싼다
            self._open("listItem")
        node_attrs: dict = {}
        if name == "heading":
            node_attrs["level"] = int(tag[1])
        elif name in ("tableCell", "tableHeader"):
            for k in ("colspan", "rowspan"):
                if a.get(k, "").isdigit() and int(a[k]) > 1:
                    node_attrs[k] = int(a[k])
        self._open(name, node_attrs)
        if name == "horizontalRule":
            self.stack.pop()  # 잎 노드

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.handle_starttag(tag, attrs)
        if tag not in ("br", "hr") and tag in NODES and NODES[tag] is not None:
            self.handle_endtag(tag)

    def handle_endtag(self, tag: str) -> None:
        if tag in MARKS:
            mark = MARKS[tag]
            for i in range(len(self.marks) - 1, -1, -1):
                if self.marks[i][0] == mark:
                    del self.marks[i:]
                    break
            return
        name = NODES.get(tag)
        if name is None or name in ("hardBreak", "horizontalRule"):
            return
        if self.unwrapped and self.unwrapped[-1] == name:
            self.unwrapped.pop()
            self._close_implicit()
            return
        # 스택에서 그 이름의 가장 안쪽 노드까지 닫는다(어긋난 태그는 같이 닫힌다). 없으면 무시
        if not any(n == name for n, _ in self.stack[1:]):
            return
        while len(self.stack) > 1:
            if self._pop() == name:
                break

    def close(self) -> None:
        super().close()
        while len(self.stack) > 1:  # 닫히지 않은 태그도 같은 규칙으로 닫는다
            self._pop()

    # ── 글자 ──
    def _ensure_text_parent(self) -> None:
        """글자를 둘 수 있는 노드가 아니면 문단을 하나 연다."""
        parent = self.stack[-1][0]
        if parent in _LISTS:
            self._open("listItem")
            parent = "listItem"
        if parent in _WRAP_TEXT:
            self._open("paragraph")
            self.implicit += 1

    def handle_data(self, data: str) -> None:
        parent = self.stack[-1][0]
        if parent in ("table", "tableRow", "bulletList", "orderedList") and not data.strip():
            return  # 구조 노드 사이 공백
        if parent not in ("codeBlock",):
            data = re.sub(
                r"[ \t\n\r\f]+", " ", data
            )  # HTML 공백 규칙 — 줄바꿈·연속 공백은 한 칸(NBSP 는 보존)
            if not data:
                return
            if parent in ("table", "tableRow"):
                return
        self._ensure_text_parent()
        if self.stack[-1][0] in ("table", "tableRow"):
            return
        attrs = None if parent == "codeBlock" else {m: dict(a) for m, a in self.marks} or None
        if self.text is None:
            self.text = XmlText()
            self.stack[-1][1].children.append(self.text)
        self.text.insert(
            len(self.text), data, attrs
        )  # pycrdt 의 글자 위치는 UTF-8 바이트다(len 도 바이트)
