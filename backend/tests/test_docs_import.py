"""파일 가져오기(README 60) — app/convert.py 변환·필터·끊기, POST /docs/import 경로.

변환 단위 테스트는 라이브러리로 만든 최소 파일이다. 실제 한글·워드가 만든 파일은 실서버에서 손으로 한 번 본다.
경로 테스트는 원본을 MinIO 에 넣으므로 MinIO 가 없으면 skip(conftest.minio_bucket).
"""

import base64
import io
import re
import time
import uuid
import xml.etree.ElementTree as ET
import zipfile
from html.parser import HTMLParser

import openpyxl
import pytest
from httpx import AsyncClient
from pycrdt import Doc, Map, XmlElement, XmlFragment, XmlText
from sqlalchemy import select

from app import convert, ydoc
from app.ai.extract import Empty, Unsupported
from app.models import AuditEvent, Document, Folder, StoredFile
from app.routers import files

from .conftest import Users, csrf, login
from .test_ai_attachments import pdf_bytes
from .test_docs import _root

_real_to_html = convert.to_html


def th(name: str, data: bytes) -> tuple[str, bool]:
    """(html, truncated) — 그림이 없는 경우의 옛 모양. Converted 전체가 필요하면 convert.to_html 을 직접."""
    c = convert.to_html(name, data)
    return c.html, c.truncated


_W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
_HP = "http://www.hancom.co.kr/hwpml/2011/paragraph"
_HS = "http://www.hancom.co.kr/hwpml/2011/section"


def make_docx(body: str, rels: str = "") -> bytes:
    ct = (
        '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
        "</Types>"
    )
    styles = (
        f'<?xml version="1.0"?><w:styles {_W}>'
        '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>'
        "</w:styles>"
    )
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("[Content_Types].xml", ct)
        z.writestr(
            "word/document.xml",
            f'<?xml version="1.0"?><w:document {_W}><w:body>{body}</w:body></w:document>',
        )
        z.writestr("word/styles.xml", styles)
        z.writestr(
            "word/_rels/document.xml.rels",
            '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            f"{rels}</Relationships>",
        )
    return buf.getvalue()


def make_hwpx(section: str) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("mimetype", "application/hwp+zip")
        z.writestr(
            "Contents/section0.xml",
            f'<?xml version="1.0"?><hs:sec xmlns:hs="{_HS}" xmlns:hp="{_HP}">{section}</hs:sec>',
        )
    return buf.getvalue()


def make_xlsx() -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "매출"
    ws.append(["이름", "금액", None])
    ws.append([None, None, None])  # 빈 행은 빠진다
    ws.append(["<김>", 1200, None])  # 뒤쪽 빈 칸은 잘린다
    wb.create_sheet("빈")
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


DOCX_BODY = (
    '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>제목 하나</w:t></w:r></w:p>'
    "<w:p><w:r><w:t>보통 </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>굵게</w:t></w:r>"
    '<w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t>밑줄</w:t></w:r></w:p>'
    "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>A1</w:t></w:r></w:p></w:tc>"
    "<w:tc><w:p><w:r><w:t>B1 &lt;x&gt;</w:t></w:r></w:p></w:tc></w:tr></w:tbl>"
    '<w:p><w:hyperlink r:id="rId9" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    "<w:r><w:t>링크</w:t></w:r></w:hyperlink></w:p>"
)
DOCX_RELS = (
    '<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" '
    'Target="javascript:alert(1)" TargetMode="External"/>'
)


DOCX = make_docx(
    DOCX_BODY, DOCX_RELS
)  # 링크 관계가 빠진 docx 는 mammoth 가 KeyError → Unsupported 다


def test_docx_to_html() -> None:
    body, truncated = th("a.docx", make_docx(DOCX_BODY, DOCX_RELS))
    assert not truncated
    assert (
        body
        == (
            "<h1>제목 하나</h1><p>보통 <strong>굵게</strong><u>밑줄</u></p>"
            '<table data-borders="none"><tr><td><p>A1</p></td><td><p>B1 &lt;x&gt;</p></td></tr></table>'
            "<p>링크</p>"  # javascript: 링크는 벗기고 글자만. tblPr 없는 표는 워드가 선을 안 그린다 → 테두리 없음
        )
    )


def test_xlsx_to_html() -> None:
    body, _ = th("a.xlsx", make_xlsx())
    assert body == (
        "<h2>매출</h2><table><tr><th><p>이름</p></th><th><p>금액</p></th></tr>"
        "<tr><td><p>&lt;김&gt;</p></td><td><p>1200</p></td></tr></table>"
        "<h2>빈</h2><table></table>"
    )


def test_hwpx_to_html() -> None:
    sec = (
        "<hp:p><hp:run><hp:t>첫 줄<hp:lineBreak/>둘째 &amp; 줄</hp:t></hp:run></hp:p>"
        '<hp:p><hp:run><hp:tbl><hp:tr><hp:tc><hp:cellSpan colSpan="2" rowSpan="1"/>'
        "<hp:subList><hp:p><hp:run><hp:t>병합</hp:t></hp:run></hp:p></hp:subList></hp:tc></hp:tr>"
        "<hp:tr><hp:tc><hp:subList><hp:p><hp:run><hp:t>a</hp:t></hp:run></hp:p></hp:subList></hp:tc>"
        "<hp:tc><hp:subList></hp:subList></hp:tc></hp:tr></hp:tbl></hp:run>"
        "<hp:run><hp:t>표 뒤</hp:t></hp:run></hp:p>"  # 같은 문단의 표 뒤 글 — run 순서대로
    )
    body, _ = th("a.hwpx", make_hwpx(sec))
    assert body == (
        "<p>첫 줄<br>둘째 &amp; 줄</p>"
        '<table><tr><td colspan="2"><p>병합</p></td></tr>'
        "<tr><td><p>a</p></td><td><p></p></td></tr></table><p>표 뒤</p>"
    )


def test_pdf_to_html(monkeypatch) -> None:
    """PDF 는 글자만 — 줄마다 문단, 꺾쇠는 escape(README 67). 추출 상한에서 잘리면 안내가 붙는다."""
    assert th("a.PDF", pdf_bytes("Hello <b>PDF")) == ("<p>Hello &lt;b&gt;PDF</p>", False)
    monkeypatch.setattr("app.ai.extract.MAX_CHARS", 5)
    assert th("a.pdf", pdf_bytes("Hello PDF")) == ("<p>Hello</p>" + convert.TRUNCATED_NOTE, True)


def test_filter_strips_unknown_tags_and_dangerous_attrs() -> None:
    f = convert._Filter()
    f.feed(
        "<script>alert(1)</script><div>글자 <span style=x>span</span><img src=x>"
        '<a href="javascript:x">j</a><a href="https://z">ok</a></div>'
        '<td colspan="abc" rowspan="2">c</td><td colspan="999">x</td>'
        '<p><a href="https://x">a<a/>b</a>c</p><p>마지막'  # 빈 <a/> 는 바깥 링크를 닫지 않는다. 닫지 않은 태그
    )
    f.close()
    assert f.result() == (
        '<p>글자 spanj<a href="https://z">ok</a></p><td rowspan="2">c</td><td>x</td>'
        '<p><a href="https://x">ab</a>c</p><p>마지막</p>',
        False,
    )


def test_rejects_unsupported_and_empty() -> None:
    with pytest.raises(Unsupported):
        th("a.pptx", b"PK")
    with pytest.raises(Unsupported):
        th("a.pdf", b"%PDF-1.4")  # 서명만 있는 깨진 PDF
    with pytest.raises(Empty):
        th("a.pdf", pdf_bytes(""))  # 글자 없는 PDF(스캔본)
    with pytest.raises(Unsupported):
        th("a.docx", b"PK\x03\x04 broken")  # 깨진 zip 도 500 이 아니라 Unsupported
    with pytest.raises(Unsupported):
        th("a.hwpx", make_docx("<w:p/>"))  # 서명은 zip 인데 섹션이 없다
    with pytest.raises(Empty):
        th("a.docx", make_docx("<w:p><w:r><w:t>  </w:t></w:r></w:p>"))


def _yjs_update_size(body: str) -> int:
    """y-prosemirror 가 만들 Y.Doc 과 같은 모양(요소 = XmlElement, 글자 = XmlText, 셀엔 colspan·rowspan 기본값)으로
    심어 업데이트 한 덩이의 크기를 잰다 — 실제 소켓 프레임 상한(realtime/yjs.py MAX_FRAME)과 견주기 위해."""
    doc = Doc()
    frag = doc.get("default", type=XmlFragment)
    stack: list = [frag]

    class B(HTMLParser):
        def handle_starttag(self, tag, attrs):
            if tag == "br":
                return
            a = dict(attrs)
            if tag in ("td", "th"):
                a = {"colspan": "1", "rowspan": "1"} | a
            el = XmlElement(tag, {k: v for k, v in a.items() if v is not None})
            stack[-1].children.append(el)
            stack.append(el)

        def handle_endtag(self, tag):
            if tag != "br":
                stack.pop()

        def handle_data(self, data):
            stack[-1].children.append(XmlText(data))

    b = B(convert_charrefs=True)
    b.feed(body)
    return len(doc.get_update())


def test_truncates_at_row_boundary_under_frame_limit() -> None:
    # 리뷰 실측: 셀 값 "1" 이 최악 — 글자 1바이트에 Yjs 는 130바이트. 500KB 글자 기준으로 끊으면 3.7MB 가 됐다
    f = convert._Filter()
    f.feed(
        "<table>"
        + "".join("<tr>" + "<td><p>1</p></td>" * 20 + "</tr>" for _ in range(4000))
        + "</table><p>끝</p>"
    )
    f.close()
    body, truncated = f.result()
    assert truncated and body.endswith("</p></td></tr></table>" + convert.TRUNCATED_NOTE)
    assert _yjs_update_size(body) < 1_000_000  # MAX_FRAME
    # 블록 하나가 상한보다 크면 안내만 남는다(원본 파일은 fileChip 으로 열 수 있다)
    g = convert._Filter()
    g.feed("<p>" + "가" * 300_000 + "</p>")
    g.close()
    assert g.result() == (convert.TRUNCATED_NOTE, True)


def test_xlsx_cell_cap_reports_truncation(monkeypatch) -> None:
    monkeypatch.setattr(convert, "MAX_XLSX_CELLS", 3)
    body, truncated = th("a.xlsx", make_xlsx())  # 머리글 2칸 + 다음 행 2칸 = 4 > 3
    assert truncated
    assert body == (
        "<h2>매출</h2><table><tr><th><p>이름</p></th><th><p>금액</p></th></tr></table>"
        + convert.TRUNCATED_NOTE
    )


def test_rejects_too_large_body_xml(monkeypatch) -> None:
    monkeypatch.setattr(convert, "MAX_XML_BYTES", 100)
    with pytest.raises(convert.TooLarge):
        th("a.docx", DOCX)
    with pytest.raises(convert.TooLarge):
        th("a.hwpx", make_hwpx("<hp:p><hp:run><hp:t>" + "가" * 100 + "</hp:t></hp:run></hp:p>"))


def test_href_filter_variants_and_cost() -> None:
    cases = {
        '<a href="JaVaScRiPt:alert(1)">x</a>': "<p>x</p>",
        '<a href="java&#x73;cript:alert(1)">x</a>': "<p>x</p>",
        '<a href="  javascript:alert(1)">x</a>': "<p>x</p>",
        '<a href="data:text/html,x">x</a>': "<p>x</p>",
        '<a href="javascript:x" href="https://ok">x</a>': '<p><a href="https://ok">x</a></p>',  # 중복이면 마지막
        '<a href="  HTTPS://ok/?a=1&b=2 ">x</a>': '<p><a href="HTTPS://ok/?a=1&amp;b=2">x</a></p>',
        f'<a href="https://x/{"a" * convert.MAX_HREF}">x</a>': "<p>x</p>",  # 너무 긴 주소는 링크를 벗긴다
    }
    for src, want in cases.items():
        f = convert._Filter()
        f.feed(src)
        f.close()
        assert f.result() == (want, False), src[:40]
    # 남긴 속성 바이트는 비용에 들어간다 — 주소가 길어도 Yjs 예산을 속이지 못하게
    f = convert._Filter()
    f.feed(f'<p><a href="https://x/{"a" * 1000}">x</a></p>')
    f.close()
    assert f.cost > 1000


def test_xlsx_fake_dimension_is_rejected_or_bounded() -> None:
    wb = openpyxl.Workbook()
    wb.active["A1"] = "x"
    buf = io.BytesIO()
    wb.save(buf)

    def with_dimension(ref: str) -> bytes:
        out = io.BytesIO()
        with zipfile.ZipFile(io.BytesIO(buf.getvalue())) as src, zipfile.ZipFile(out, "w") as dst:
            for info in src.infolist():
                data = src.read(info.filename)
                if info.filename == "xl/worksheets/sheet1.xml":
                    data = data.replace(
                        b'<dimension ref="A1:A1" />', f'<dimension ref="{ref}" />'.encode()
                    )
                dst.writestr(info, data)
        return out.getvalue()

    with pytest.raises(convert.TooLarge):  # 160억 칸 선언 — 돌기 전에 거절(Codex 리뷰)
        th("a.xlsx", with_dimension("A1:XFD1048576"))
    # 선언이 상한 아래라도 두 칸 사이의 빈 행을 read_only 가 1024칸짜리로 돌려준다 — 도는 칸 수(MAX_XLSX_VISITED)에서 끊는다
    wb.active["AMJ5000"] = "끝"
    far = io.BytesIO()
    wb.save(far)
    body, truncated = th("a.xlsx", far.getvalue())
    assert truncated and body.startswith("<h2>Sheet</h2><table><tr><th><p>x</p></th></tr></table>")


def test_zip_entry_count_limit() -> None:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("mimetype", "application/hwp+zip")
        for i in range(2001):
            z.writestr(f"junk/{i}", b"")
    with pytest.raises(Unsupported):
        th("a.hwpx", buf.getvalue())


def _sorted_attrs(xml: str) -> str:
    """Yjs 요소의 속성 출력 순서는 고정이 아니다 — 태그마다 속성을 이름순으로 다시 써서 견준다."""

    def fix(m: re.Match) -> str:
        attrs = sorted(re.findall(r' ([\w-]+="[^"]*")', m.group(2)))
        return f"<{m.group(1)}{''.join(' ' + a for a in attrs)}>"

    return re.sub(r"<(\w+)((?: [\w-]+=\"[^\"]*\")+)>", fix, xml)


def ydoc_fragment(update: bytes) -> str:
    doc = Doc()
    doc.apply_update(update)
    return _sorted_attrs(str(doc.get("default", type=XmlFragment)))


def test_ydoc_build_matches_editor_schema_shape() -> None:
    """프론트 편집기 스키마로 실제로 읽어 봤다(PR 본문의 vitest 검증) — 여기서는 모양을 고정한다."""
    html = (
        '<h1>제목 하나</h1><h3>소제목</h3><p>보통 <strong>굵게 <em>둘</em></strong><u>밑줄</u> <a href="https://z">링크</a><br>줄2</p>'
        "<ul><li>하나</li><li><p>둘</p></li></ul><ol>셋</ol>"
        '<table><thead><tr><th colspan="2"><p>머리</p></th></tr></thead><tbody><tr><td><p>A</p></td><td rowspan="2"><p>B <code>x</code></p></td></tr></tbody></table>'
        "<pre><code>print(1)\n  두줄</code></pre><blockquote>인용</blockquote><hr><p></p>떠도는 글자"
    )
    update = ydoc.build(html, "제목", ("/api/files/abc", "기획서.docx", 1234))
    assert (
        ydoc_fragment(update)
        == (
            '<heading level="1">제목 하나</heading><heading level="3">소제목</heading>'
            "<paragraph>보통 <bold>굵게 </bold><bold><italic>둘</italic></bold><underline>밑줄</underline> "
            '<link href="https://z" rel="noopener noreferrer nofollow" target="_blank">링크</link><hardBreak></hardBreak>줄2</paragraph>'
            "<bulletList><listItem><paragraph>하나</paragraph></listItem><listItem><paragraph>둘</paragraph></listItem></bulletList>"
            "<orderedList><listItem><paragraph>셋</paragraph></listItem></orderedList>"  # 목록 바로 아래 글자는 항목으로
            '<table><tableRow><tableHeader colspan="2"><paragraph>머리</paragraph></tableHeader></tableRow>'
            '<tableRow><tableCell><paragraph>A</paragraph></tableCell><tableCell rowspan="2"><paragraph>B <code>x</code></paragraph></tableCell></tableRow></table>'
            "<codeBlock>print(1)\n  두줄</codeBlock><blockquote><paragraph>인용</paragraph></blockquote><horizontalRule></horizontalRule>"
            "<paragraph></paragraph><paragraph>떠도는 글자</paragraph>"
            '<paragraph><fileChip name="기획서.docx" size="1234" src="/api/files/abc"></fileChip></paragraph>'
        )
    )
    doc = Doc()
    doc.apply_update(update)
    assert doc.get("meta", type=Map)["title"] == "제목"
    assert ydoc.plain_text(update).startswith("제목 하나\n소제목\n보통 굵게 둘밑줄 링크")


def test_ydoc_marks_use_byte_offsets_correctly() -> None:
    # pycrdt 의 글자 위치는 UTF-8 바이트 — 한글 뒤에 마크를 열면 글자가 뒤섞였다(한 문단 = XmlText 하나)
    update = ydoc.build("<p>가나다 <strong>라마</strong>바사</p>", "t")
    assert ydoc_fragment(update) == "<paragraph>가나다 <bold>라마</bold>바사</paragraph>"


def test_ydoc_fixes_structure_to_schema() -> None:
    """content 규칙(table>tableRow>cell>paragraph+, list>listItem>paragraph block*)에 안 맞는 입력을 고친다.
    프론트 스키마로 읽어 확인한 입력 모음(PR 본문) — 통째로 버려지는 노드가 없어야 한다."""
    cases = {
        "<h2>빈</h2><table></table><p>뒤</p>": '<heading level="2">빈</heading><paragraph>뒤</paragraph>',  # 빈 표(xlsx 빈 시트)는 지운다
        "<ul></ul><ul><li></li><li><ul><li>속</li></ul></li></ul>": (
            "<bulletList><listItem><paragraph></paragraph></listItem>"
            "<listItem><paragraph></paragraph><bulletList><listItem><paragraph>속</paragraph></listItem></bulletList></listItem></bulletList>"
        ),  # 빈 항목·중첩 목록 앞엔 문단
        "<table><tr></tr><tr><td></td><th>x</th></tr></table>": (
            "<table><tableRow><tableCell><paragraph></paragraph></tableCell><tableHeader><paragraph>x</paragraph></tableHeader></tableRow></table>"
        ),  # 빈 행은 지우고 빈 셀엔 문단
        "<table><tr><td><table><tr><td>안</td></tr></table>밖<ul><li>항목</li></ul></td></tr></table>": (
            "<table><tableRow><tableCell><paragraph>안</paragraph><paragraph>밖</paragraph><paragraph>항목</paragraph></tableCell></tableRow></table>"
        ),  # 셀 안의 표·목록은 문단으로
        "<blockquote></blockquote><p><strong></strong>글</p>a<br>b": "<paragraph>글</paragraph><paragraph>a<hardBreak></hardBreak>b</paragraph>",
        "<li>떠도는 항목</li><td>떠도는 셀</td><tr><td>x</td></tr>": "<paragraph>떠도는 항목</paragraph><paragraph>떠도는 셀</paragraph><paragraph>x</paragraph>",
        "<table><tr><td><p>A</p></td></tr>떠도는<tr><td>C</td></tr></table>": (
            "<table><tableRow><tableCell><paragraph>A</paragraph></tableCell></tableRow><tableRow><tableCell><paragraph>C</paragraph></tableCell></tableRow></table>"
        ),  # 표 안의 떠도는 글자는 버린다
    }
    for html, want in cases.items():
        assert ydoc_fragment(ydoc.build(html, "t")) == want, html


def test_ydoc_blocks_inside_inline_parents_close_the_parent() -> None:
    """문단·제목·코드블록 안에 블록이 오면 부모를 먼저 닫는다(브라우저 규칙). 안 그러면 Tiptap 이 그 문단을 통째로 버린다(리뷰)."""
    nbsp = chr(0xA0)
    cases = {
        "<p>a<hr>b</p>": "<paragraph>a</paragraph><horizontalRule></horizontalRule><paragraph>b</paragraph>",
        "<p>a<table><tr><td>x</td></tr></table>b</p>": (
            "<paragraph>a</paragraph><table><tableRow><tableCell><paragraph>x</paragraph></tableCell></tableRow></table><paragraph>b</paragraph>"
        ),
        "<pre>a<strong>b</strong><br>c</pre>": "<codeBlock>ab"
        + chr(10)
        + "c</codeBlock>",  # 코드블록 안은 마크 없이 글자만, br 은 줄바꿈 글자
        "<table><tr><br><td>x</td></tr></table>": "<table><tableRow><tableCell><paragraph>x</paragraph></tableCell></tableRow></table>",  # 구조 사이 br 은 버림
        "<h2>t<ul><li>i</li></ul></h2>": '<heading level="2">t</heading><bulletList><listItem><paragraph>i</paragraph></listItem></bulletList>',
        f"<p>a{nbsp}{nbsp}b   c</p>": f"<paragraph>a{nbsp}{nbsp}b c</paragraph>",  # NBSP 는 접지 않는다
    }
    for html, want in cases.items():
        assert ydoc_fragment(ydoc.build(html, "t")) == want, html


def test_xlsx_pads_ragged_rows() -> None:
    # 머리행이 짧으면 편집기가 열 때 빈 칸을 앞에 넣어 머리글이 오른쪽으로 밀린다(리뷰) — 가장 긴 행까지 채운다
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "S"
    ws.append(["h"])
    ws.append(["x", "y", "z"])
    buf = io.BytesIO()
    wb.save(buf)
    body, _ = th("a.xlsx", buf.getvalue())
    assert body == (
        "<h2>S</h2><table><tr><th><p>h</p></th><th><p></p></th><th><p></p></th></tr>"
        "<tr><td><p>x</p></td><td><p>y</p></td><td><p>z</p></td></tr></table>"
    )


# ── 서식 2차(README 62) ──────────────────────────────────────────────────────────

_WNS = (
    'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" '
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
)


def png_1x1() -> bytes:
    import struct
    import zlib

    def chunk(t: bytes, d: bytes) -> bytes:
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(b"\x00\x00\x00\x00"))
        + chunk(b"IEND", b"")
    )


def make_rich_docx(image: bytes | None = png_1x1()) -> bytes:
    body = (
        '<w:p><w:pPr><w:pStyle w:val="1"/><w:jc w:val="center"/></w:pPr><w:r><w:t>가운데 제목</w:t></w:r></w:p>'
        '<w:p><w:pPr><w:jc w:val="both"/></w:pPr><w:r><w:rPr><w:b/><w:color w:val="FF0000"/><w:highlight w:val="yellow"/></w:rPr><w:t>빨강 굵게 형광</w:t></w:r>'
        '<w:r><w:rPr><w:u w:val="single"/><w:shd w:val="clear" w:fill="BBF7D0"/></w:rPr><w:t> 밑줄</w:t></w:r>'
        '<w:hyperlink r:id="rId5"><w:r><w:t>링크</w:t></w:r></w:hyperlink></w:p>'
        '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>항목1</w:t></w:r></w:p>'
        '<w:p><w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>하위</w:t></w:r></w:p>'
        '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr><w:r><w:t>번호1</w:t></w:r></w:p>'
        '<w:p><w:r><w:drawing><wp:inline><wp:extent cx="1905000" cy="952500"/><a:graphic><a:graphicData>'
        '<pic:pic xmlns:pic="x"><pic:blipFill><a:blip r:embed="rId7"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>'
        '<w:tbl><w:tr><w:trPr><w:tblHeader/></w:trPr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>머리</w:t></w:r></w:p></w:tc></w:tr>'
        '<w:tr><w:tc><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:i/></w:rPr><w:t>A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
        "<w:p><w:r><w:t>끝</w:t></w:r></w:p>"
    )
    styles = f'<w:styles {_WNS}><w:style w:type="paragraph" w:styleId="1"><w:name w:val="heading 1"/></w:style></w:styles>'
    numbering = (
        f'<w:numbering {_WNS}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl>'
        '<w:lvl w:ilvl="1"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum>'
        '<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum>'
        '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>'
    )
    rels = (
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId5" Type="x/hyperlink" Target="https://z.example" TargetMode="External"/>'
        '<Relationship Id="rId7" Type="x/image" Target="media/image1.png"/></Relationships>'
    )
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        z.writestr(
            "word/document.xml",
            f'<?xml version="1.0"?><w:document {_WNS}><w:body>{body}</w:body></w:document>',
        )
        z.writestr("word/styles.xml", styles)
        z.writestr("word/numbering.xml", numbering)
        z.writestr("word/_rels/document.xml.rels", rels)
        if image is not None:
            z.writestr("word/media/image1.png", image)
    return buf.getvalue()


RICH_DOCX_HTML = (
    '<h1 style="text-align:center">가운데 제목</h1>'
    '<p style="text-align:justify"><span style="color:#ff0000"><mark data-color="#ffff00"><strong>빨강 굵게 형광</strong></mark></span>'
    '<mark data-color="#bbf7d0"><u> 밑줄</u></mark><a href="https://z.example">링크</a></p>'
    "<ul><li>항목1<ul><li>하위</li></ul></li></ul><ol><li>번호1</li></ol>"
    '<p><img data-ref="0" width="200"></p>'
    '<table data-borders="none"><tr><th colspan="2"><p>머리</p></th></tr><tr><td><p style="text-align:right"><em>A</em></p></td><td><p>B</p></td></tr></table>'
    "<p>끝</p>"
)


def test_rich_docx_formatting() -> None:
    c = convert.to_html("a.docx", make_rich_docx())
    assert (c.html, c.truncated) == (RICH_DOCX_HTML, False)
    assert len(c.images) == 1 and c.images[0][1] == "image/png"
    # 그림 파일이 그림 형식이 아니면(emf 등) 그 자리만 비운다
    c2 = convert.to_html("a.docx", make_rich_docx(image=b"not an image"))
    assert c2.images == [] and "<img" not in c2.html and "<p>끝</p>" in c2.html


def test_rich_docx_to_ydoc_marks_attrs_image() -> None:
    frag = ydoc_fragment(ydoc.build(RICH_DOCX_HTML, "t", None, ["/api/files/img1"]))
    assert frag.startswith(
        '<heading level="1" textAlign="center">가운데 제목</heading><paragraph textAlign="justify">'
    )
    assert (
        '<highlight color="#ffff00"><textStyle color="#ff0000">빨강 굵게 형광</textStyle></highlight>'
        in frag
    )
    # 그림만 있던 문단은 지우고 imageBlock 을 블록으로. 폭은 숫자
    assert "<paragraph></paragraph><imageBlock" not in frag
    assert (
        '<imageBlock src="/api/files/img1" width="200"></imageBlock><table borders="none">' in frag
    )
    assert '<tableHeader colspan="2"><paragraph>머리</paragraph></tableHeader>' in frag
    assert '<paragraph textAlign="right"><italic>A</italic></paragraph>' in frag
    # 올리지 못한 그림(번호 범위 밖)은 자리를 비운다
    assert "imageBlock" not in ydoc_fragment(
        ydoc.build('<p><img data-ref="3"></p><p>a</p>', "t", None, ["/x"])
    )


def test_filter_formatting_attrs() -> None:
    f = convert._Filter(n_images=1)
    f.feed(
        '<p style="text-align: Center; color: red">a</p><h2 style="text-align:left">b</h2>'
        '<span style="color:#abc">c</span><span style="font-size:3em">d</span><mark data-color="#FEF08A">e</mark><mark data-color="red">f</mark>'
        '<img data-ref="0" width="99999" alt="그림"><img data-ref="7"><img src="https://x/evil.png">'
    )
    f.close()
    # left 는 생략, #abc 는 #aabbcc, 이름 색은 버림, 폭 상한 밖은 생략, 범위 밖·바깥 주소 img 는 벗김
    assert f.result() == (
        '<p style="text-align:center">a</p><h2>b</h2>'
        '<p><span style="color:#aabbcc">c</span>d<mark data-color="#fef08a">e</mark><mark>f</mark></p>'
        '<img data-ref="0" alt="그림">',
        False,
    )
    assert f.images == 1


def test_xlsx_cell_formatting() -> None:
    from openpyxl.styles import Alignment, Font, PatternFill

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "S"
    ws["A1"] = "머리"
    ws["A1"].font = Font(bold=True)
    ws["B1"] = "x"
    ws["A2"] = "빨강"
    ws["A2"].font = Font(color="FFFF0000", italic=True)
    ws["A2"].alignment = Alignment(horizontal="center")
    ws["A2"].fill = PatternFill("solid", fgColor="FFFFFF00")
    ws["B2"] = 3
    buf = io.BytesIO()
    wb.save(buf)
    body, _ = th("a.xlsx", buf.getvalue())
    assert (
        body
        == (
            "<h2>S</h2><table><tr><th><p><strong>머리</strong></p></th><th><p>x</p></th></tr>"
            '<tr><td style="background-color:#ffff00"><p style="text-align:center"><span style="color:#ff0000"><em>빨강</em></span></p></td>'
            "<td><p>3</p></td></tr></table>"  # 채우기는 셀 배경으로(계약 backgroundColor), 기본 글꼴 Calibri 11 은 싣지 않는다
        )
    )


def make_rich_hwpx() -> bytes:
    hh = "http://www.hancom.co.kr/hwpml/2011/head"
    hc = "http://www.hancom.co.kr/hwpml/2011/core"
    header = (
        f'<hh:head xmlns:hh="{hh}"><hh:refList><hh:charProperties>'
        '<hh:charPr id="0" textColor="#000000" shadeColor="none"/>'
        '<hh:charPr id="1" textColor="#FF0000" shadeColor="#FEF08A"><hh:bold/><hh:underline type="BOTTOM"/></hh:charPr>'
        "</hh:charProperties><hh:paraProperties>"
        '<hh:paraPr id="0"><hh:align horizontal="JUSTIFY"/><hh:heading type="NONE" level="0"/></hh:paraPr>'
        '<hh:paraPr id="1"><hh:align horizontal="CENTER"/><hh:heading type="OUTLINE" level="0"/></hh:paraPr>'
        "</hh:paraProperties></hh:refList></hh:head>"
    )
    section = (
        f'<hp:p paraPrIDRef="1" xmlns:hc="{hc}"><hp:run charPrIDRef="0"><hp:t>개요 제목</hp:t></hp:run></hp:p>'
        f'<hp:p paraPrIDRef="0" xmlns:hc="{hc}"><hp:run charPrIDRef="1"><hp:t>굵은 빨강</hp:t></hp:run>'
        '<hp:run charPrIDRef="0"><hp:t> 보통</hp:t><hp:pic><hp:sz width="7500" height="3000"/><hc:img binaryItemIDRef="image1"/></hp:pic></hp:run></hp:p>'
    )
    hpf = (
        '<opf:package xmlns:opf="http://www.idpf.org/2007/opf/"><opf:manifest>'
        '<opf:item id="image1" href="BinData/image1.png" media-type="image/png"/></opf:manifest></opf:package>'
    )
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("mimetype", "application/hwp+zip")
        z.writestr("Contents/header.xml", header)
        z.writestr(
            "Contents/section0.xml",
            f'<?xml version="1.0"?><hs:sec xmlns:hs="{_HS}" xmlns:hp="{_HP}">{section}</hs:sec>',
        )
        z.writestr("Contents/content.hpf", hpf)
        z.writestr("BinData/image1.png", png_1x1())
    return buf.getvalue()


def test_rich_hwpx_formatting() -> None:
    c = convert.to_html("a.hwpx", make_rich_hwpx())
    assert c.html == (
        '<h1 style="text-align:center">개요 제목</h1>'
        '<p style="text-align:justify"><span style="color:#ff0000"><mark data-color="#fef08a"><u><strong>굵은 빨강</strong></u></mark></span> 보통</p>'
        '<img data-ref="0" width="100">'
    )
    assert len(c.images) == 1


def test_fmt_review_regressions(monkeypatch) -> None:
    """서식 2차 리뷰 지적 모음(README 62)."""
    # (1) 셀 안 그림은 벗겨지되 바깥 표를 깨뜨리지 않는다 — img 는 끝 태그가 없어 unwrapped 스택에 남으면 안 된다
    frag = ydoc_fragment(
        ydoc.build(
            '<table><tr><td><table><tr><td><img data-ref="0"></td></tr></table></td><td>B</td></tr><tr><td>C</td><td>D</td></tr></table>',
            "t",
            None,
            ["/api/files/i"],
        )
    )
    assert frag == (
        "<table><tableRow><tableCell><paragraph></paragraph></tableCell><tableCell><paragraph>B</paragraph></tableCell></tableRow>"
        "<tableRow><tableCell><paragraph>C</paragraph></tableCell><tableCell><paragraph>D</paragraph></tableCell></tableRow></table>"
    )
    # 쓰인 그림 번호만 돌려준다 — 셀 안 그림은 문서에 없으니 라우터가 올리지 않는다
    used: set[int] = set()
    ydoc.build(
        '<table><tr><td><img data-ref="0"></td></tr></table><p><img data-ref="1"></p>',
        "t",
        None,
        ["/a", "/b"],
        used,
    )
    assert used == {1}
    # (2) 그림 뒤 글자는 같은 문단 속성(정렬·제목 수준)으로 이어진다
    frag = ydoc_fragment(
        ydoc.build(
            '<h2 style="text-align:center">앞<img data-ref="0">뒤</h2><p>다음</p>',
            "t",
            None,
            ["/i"],
        )
    )
    assert frag == (
        '<heading level="2" textAlign="center">앞</heading><imageBlock src="/i"></imageBlock>'
        '<heading level="2" textAlign="center">뒤</heading><paragraph>다음</paragraph>'
    )
    # (3) numId 0(번호 끄기)·numbering 에 없는 번호·음수 ilvl 은 보통 문단
    body = (
        '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="0"/></w:numPr></w:pPr><w:r><w:t>끈 번호</w:t></w:r></w:p>'
        '<w:p><w:pPr><w:numPr><w:ilvl w:val="-1"/><w:numId w:val="9"/></w:numPr></w:pPr><w:r><w:t>없는 번호</w:t></w:r></w:p>'
    )
    assert th("a.docx", make_docx(body))[0] == "<p>끈 번호</p><p>없는 번호</p>"
    # (4) 절대 경로 Target 그림도 찾는다
    rich = make_rich_docx()
    buf = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(rich)) as src, zipfile.ZipFile(buf, "w") as dst:
        for info in src.infolist():
            data = src.read(info.filename)
            if info.filename == "word/_rels/document.xml.rels":
                data = data.replace(
                    b'Target="media/image1.png"', b'Target="/word/media/image1.png"'
                )
            dst.writestr(info, data)
    assert len(convert.to_html("a.docx", buf.getvalue()).images) == 1
    # (5) styles·numbering·rels·header.xml 도 본문 XML 상한을 받는다
    monkeypatch.setattr(convert, "MAX_XML_BYTES", 300)
    with pytest.raises(convert.TooLarge):
        convert.to_html("a.docx", make_rich_docx())  # numbering.xml 이 300 바이트를 넘는다
    with pytest.raises(convert.TooLarge):
        convert.to_html("a.hwpx", make_rich_hwpx())  # header.xml
    monkeypatch.setattr(convert, "MAX_XML_BYTES", 2 * 1024 * 1024)
    # (6) 같은 그림을 여러 번 넣어도 한 번만 꺼낸다
    body = (
        f'<w:p><w:r><w:drawing {_WNS}><wp:inline><a:graphic><a:graphicData><pic:pic xmlns:pic="x"><pic:blipFill><a:blip r:embed="rId7"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>'
        * 3
    )
    rels = '<Relationship Id="rId7" Type="x/image" Target="media/image1.png"/>'
    buf = io.BytesIO()
    with (
        zipfile.ZipFile(io.BytesIO(make_docx(body, rels))) as src,
        zipfile.ZipFile(buf, "w") as dst,
    ):
        for info in src.infolist():
            dst.writestr(info, src.read(info.filename))
        dst.writestr("word/media/image1.png", png_1x1())
    c = convert.to_html("a.docx", buf.getvalue())
    assert len(c.images) == 1 and c.html.count('<img data-ref="0">') == 3


def test_fmt_codex_regressions(monkeypatch) -> None:
    """Codex 교차검증 지적 모음(README 62)."""
    # (1) DOCTYPE·내부 엔티티가 든 XML 은 받지 않는다(엔티티 확장 폭탄)
    bomb = (
        '<!DOCTYPE d [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">]>'
        "<w:p><w:r><w:t>&b;</w:t></w:r></w:p>"
    )
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        z.writestr(
            "word/document.xml",
            bomb.split("]>")[0]
            + "]>"
            + f"<w:document {_W}><w:body>"
            + bomb.split("]>")[1]
            + "</w:body></w:document>",
        )
    with pytest.raises(Unsupported):
        convert.to_html("a.docx", buf.getvalue())
    # (2) xlsx 의 styles.xml 도 본문 XML 상한 — openpyxl 이 통째로 객체화한다
    monkeypatch.setattr(convert, "MAX_XML_BYTES", 500)
    with pytest.raises(convert.TooLarge):
        convert.to_html("a.xlsx", make_xlsx())  # 기본 styles.xml 이 500 바이트를 넘는다
    monkeypatch.setattr(convert, "MAX_XML_BYTES", 2 * 1024 * 1024)
    # (3) 목록: 깊이 점프는 한 단계로, 같은 형식이라도 numId 가 바뀌면 새 목록
    body = (
        '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>a</w:t></w:r></w:p>'
        '<w:p><w:pPr><w:numPr><w:ilvl w:val="2"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>c</w:t></w:r></w:p>'
        '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr><w:r><w:t>x</w:t></w:r></w:p>'
    )
    numbering = (
        f'<w:numbering {_W}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl>'
        '<w:lvl w:ilvl="1"><w:numFmt w:val="decimal"/></w:lvl><w:lvl w:ilvl="2"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum>'
        '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="0"/></w:num></w:numbering>'
    )
    buf = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(make_docx(body))) as src, zipfile.ZipFile(buf, "w") as dst:
        for info in src.infolist():
            dst.writestr(info, src.read(info.filename))
        dst.writestr("word/numbering.xml", numbering)
    assert (
        th("a.docx", buf.getvalue())[0]
        == "<ol><li>a<ol><li>c</li></ol></li></ol><ol><li>x</li></ol>"
    )
    # (4) 세로 병합(vMerge)은 시작 칸에 rowspan, 이어지는 칸은 뺀다
    body = (
        '<w:tbl><w:tr><w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc>'
        "<w:tc><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc></w:tr>"
        "<w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc><w:tc><w:p><w:r><w:t>C</w:t></w:r></w:p></w:tc></w:tr></w:tbl>"
    )
    assert th("a.docx", make_docx(body))[0] == (
        '<table data-borders="none"><tr><td rowspan="2"><p>A</p></td><td><p>B</p></td></tr><tr><td><p>C</p></td></tr></table>'
    )
    # (5) hwpx 의 일부러 띄운 빈 문단은 남는다
    sec = "<hp:p><hp:run><hp:t>A</hp:t></hp:run></hp:p><hp:p><hp:run><hp:t></hp:t></hp:run></hp:p><hp:p><hp:run><hp:t>B</hp:t></hp:run></hp:p>"
    assert th("a.hwpx", make_hwpx(sec))[0] == "<p>A</p><p></p><p>B</p>"
    # (6) 같은 바이트가 다른 이름으로 들어 있어도 한 장
    body = "".join(
        f'<w:p><w:r><w:drawing {_WNS}><wp:inline><a:graphic><a:graphicData><pic:pic xmlns:pic="x"><pic:blipFill><a:blip r:embed="rId{i}"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>'
        for i in (7, 8)
    )
    rels = (
        '<Relationship Id="rId7" Type="x/image" Target="media/image1.png"/>'
        '<Relationship Id="rId8" Type="x/image" Target="media/image2.png"/>'
    )
    buf = io.BytesIO()
    with (
        zipfile.ZipFile(io.BytesIO(make_docx(body, rels))) as src,
        zipfile.ZipFile(buf, "w") as dst,
    ):
        for info in src.infolist():
            dst.writestr(info, src.read(info.filename))
        dst.writestr("word/media/image1.png", png_1x1())
        dst.writestr("word/media/image2.png", png_1x1())
    c = convert.to_html("a.docx", buf.getvalue())
    assert len(c.images) == 1 and c.html.count('<img data-ref="0">') == 2


# ── 서식 3차(README 63, 계약 #574) ────────────────────────────────────────────────


def test_fmt3_docx_fonts_spacing_table() -> None:
    styles = (
        f'<w:styles {_WNS}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:eastAsia="맑은 고딕"/><w:sz w:val="20"/></w:rPr></w:rPrDefault></w:docDefaults>'
        '<w:style w:type="paragraph" w:styleId="1"><w:name w:val="heading 1"/></w:style></w:styles>'
    )
    body = (
        # 기본 글꼴(맑은 고딕 10pt)과 같은 run 은 마크 없음, 다른 글꼴·크기만 span
        '<w:p><w:pPr><w:spacing w:before="240" w:after="120" w:line="360" w:lineRule="auto"/><w:ind w:left="720"/></w:pPr>'
        '<w:r><w:rPr><w:rFonts w:eastAsia="맑은 고딕"/><w:sz w:val="20"/></w:rPr><w:t>기본 </w:t></w:r>'
        '<w:r><w:rPr><w:rFonts w:ascii="Arial" w:eastAsia="나눔명조"/><w:sz w:val="28"/></w:rPr><w:t>큰 명조</w:t></w:r></w:p>'
        # 표: 윗변만 명시(tblStyle 없음) → 표는 테두리 있음(all), 적히지 않은 세 변은 none(서식 4차), 셀 폭·배경
        '<w:tbl><w:tblPr><w:tblBorders><w:top w:val="single"/></w:tblBorders></w:tblPr><w:tr><w:tc><w:tcPr><w:tcW w:w="1800" w:type="dxa"/><w:shd w:val="clear" w:fill="FEF08A"/></w:tcPr><w:p><w:r><w:t>칸</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
        # 테두리 전부 none → 테두리 없음
        '<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblBorders><w:top w:val="none"/><w:left w:val="nil"/><w:bottom w:val="none"/><w:right w:val="none"/><w:insideH w:val="none"/><w:insideV w:val="none"/></w:tblBorders></w:tblPr>'
        "<w:tr><w:tc><w:p><w:r><w:t>x</w:t></w:r></w:p></w:tc></w:tr></w:tbl>"
    )
    buf = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(make_docx(body))) as src, zipfile.ZipFile(buf, "w") as dst:
        for info in src.infolist():
            if info.filename != "word/styles.xml":
                dst.writestr(info, src.read(info.filename))
        dst.writestr("word/styles.xml", styles)
    assert th("a.docx", buf.getvalue())[0] == (
        '<p style="line-height:1.5;margin-left:48px;margin-top:16px;margin-bottom:8px">기본 '
        '<span style="font-family:나눔명조;font-size:14pt">큰 명조</span></p>'
        '<table><tr><td style="background-color:#fef08a;width:120px;border-right:none;border-bottom:none;border-left:none"><p>칸</p></td></tr></table>'
        '<table data-borders="none"><tr><td><p>x</p></td></tr></table>'
    )  # 240twip=16px, 720twip=48px, 1800twip=120px, line 360/240=1.5, sz 28 = 14pt, eastAsia 우선


def test_fmt3_hwpx_fonts_spacing_cells() -> None:
    hh = "http://www.hancom.co.kr/hwpml/2011/head"
    header = (
        f'<hh:head xmlns:hh="{hh}"><hh:refList>'
        '<hh:fontfaces><hh:fontface lang="HANGUL"><hh:font id="0" face="함초롬바탕"/><hh:font id="1" face="나눔스퀘어"/></hh:fontface></hh:fontfaces>'
        '<hh:borderFills><hh:borderFill id="1"><hh:leftBorder type="NONE"/><hh:rightBorder type="NONE"/><hh:topBorder type="NONE"/><hh:bottomBorder type="NONE"/></hh:borderFill>'
        '<hh:borderFill id="2"><hh:leftBorder type="SOLID"/><hh:fillBrush><hh:winBrush faceColor="#BFDBFE"/></hh:fillBrush></hh:borderFill></hh:borderFills>'
        '<hh:charProperties><hh:charPr id="0" height="1000" textColor="#000000" shadeColor="none"><hh:fontRef hangul="0"/></hh:charPr>'
        '<hh:charPr id="1" height="1600" textColor="#000000" shadeColor="none"><hh:fontRef hangul="1"/><hh:bold/></hh:charPr></hh:charProperties>'
        '<hh:paraProperties><hh:paraPr id="0"/><hh:paraPr id="1"><hh:align horizontal="LEFT"/><hh:heading type="NONE" level="0"/>'
        '<hh:margin><hh:left value="1500" unit="HWPUNIT"/><hh:prev value="750" unit="HWPUNIT"/><hh:next value="0" unit="HWPUNIT"/></hh:margin>'
        '<hh:lineSpacing type="PERCENT" value="180"/></hh:paraPr></hh:paraProperties></hh:refList></hh:head>'
    )
    section = (
        '<hp:p paraPrIDRef="1"><hp:run charPrIDRef="0"><hp:t>기본 </hp:t></hp:run><hp:run charPrIDRef="1"><hp:t>큰 스퀘어</hp:t></hp:run></hp:p>'
        '<hp:p paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:tbl borderFillIDRef="1"><hp:tr><hp:tc borderFillIDRef="2"><hp:cellSz width="7500" height="1000"/>'
        '<hp:subList><hp:p><hp:run charPrIDRef="0"><hp:t>칸</hp:t></hp:run></hp:p></hp:subList></hp:tc></hp:tr></hp:tbl></hp:run></hp:p>'
    )
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("mimetype", "application/hwp+zip")
        z.writestr("Contents/header.xml", header)
        z.writestr(
            "Contents/section0.xml",
            f'<?xml version="1.0"?><hs:sec xmlns:hs="{_HS}" xmlns:hp="{_HP}">{section}</hs:sec>',
        )
    assert (
        th("a.hwpx", buf.getvalue())[0]
        == (
            '<p style="line-height:1.8;margin-left:20px;margin-top:10px">기본 <span style="font-family:나눔스퀘어;font-size:16pt"><strong>큰 스퀘어</strong></span></p>'
            '<table><tr style="height:13px"><td style="background-color:#bfdbfe;width:100px"><p>칸</p></td></tr></table>'
        )
    )  # height 1600 = 16pt, 1500 HWPUNIT = 20px, 7500 = 100px(1000 = 13px 행), 기본 글자 모양(id 0)의 글꼴·크기는 싣지 않는다


def test_fmt3_xlsx_fonts_and_column_widths() -> None:
    from openpyxl.styles import Font

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "S"
    ws["A1"] = "굵은 큰 글"
    ws["A1"].font = Font(name="나눔고딕", size=14, bold=True)
    ws["B1"] = "기본"
    ws.column_dimensions["A"].width = 30  # 30자 ≈ 215px
    buf = io.BytesIO()
    wb.save(buf)
    assert th("a.xlsx", buf.getvalue())[0] == (
        '<h2>S</h2><table><tr><th style="width:210px"><p><span style="font-family:나눔고딕;font-size:14pt"><strong>굵은 큰 글</strong></span></p></th>'
        "<th><p>기본</p></th></tr></table>"
    )


def test_fmt3_filter_sanitizes_style_values() -> None:
    f = convert._Filter()
    f.feed(
        '<p style="line-height: 1.6; margin-left: 40px; margin-top: 9999px; color: red">a</p>'
        "<span style=\"font-family: '맑은 고딕'; background:url(https://x); font-size: 11pt\">b</span>"
        '<span style="font-family: Arial, sans-serif</span><script>">c</span>'
        '<span style="font-size:200pt">d</span><span style="color:#000000;font-family:&quot;Evil&quot;;">e</span>'
        '<table data-borders="none"><tr><td style="width:120px;background-color:#abc;border:9px">x</td><td style="width:99999px">y</td></tr></table>'
    )
    f.close()
    assert (
        f.result()
        == (
            '<p style="line-height:1.6;margin-left:40px">a</p>'  # 상한 밖(margin-top 9999) 은 버림, color 는 문단 속성이 아니다
            "<p><span style=\"font-family:'맑은 고딕';font-size:11pt\">b</span>"  # background:url 은 벗겨진다
            '<span style="font-family:Arial, sans-serif">c</span>'  # 글꼴 이름엔 허용 글자만 — < > / 는 지워진다
            "d"  # 200pt 는 범위 밖 → 속성 없는 span 은 벗김
            '<span style="color:#000000;font-family:Evil">e</span></p>'  # 큰따옴표는 홑따옴표로 바뀐 뒤 벗겨진다
            '<table data-borders="none"><tr><td style="background-color:#aabbcc;width:120px">x</td><td>y</td></tr></table>',
            False,
        )
    )


def test_fmt3_ydoc_attrs() -> None:
    frag = ydoc_fragment(
        ydoc.build(
            '<p style="text-align:center;line-height:1.6;margin-left:40px;margin-top:8px;margin-bottom:4px">'
            "<span style=\"color:#ff0000;font-family:'맑은 고딕';font-size:11pt\">a</span></p>"
            '<table data-borders="none"><tr><td style="background-color:#aabbcc;width:120px"><p>x</p></td></tr></table>',
            "t",
        )
    )
    assert frag == (
        '<paragraph indent="40" lineHeight="1.6" spaceAfter="4" spaceBefore="8" textAlign="center">'
        '<textStyle color="#ff0000" fontFamily="\'맑은 고딕\'" fontSize="11pt">a</textStyle></paragraph>'
        '<table borders="none"><tableRow><tableCell backgroundColor="#aabbcc" colwidth="[120]"><paragraph>x</paragraph></tableCell></tableRow></table>'
    )


def test_fmt3_review_regressions(monkeypatch) -> None:
    # (1) 시트 XML 이 2MB 를 넘어도 열 너비 때문에 거절하지 않는다 — 앞부분만 읽는다
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "S"
    ws["A1"] = "x"
    ws.column_dimensions["A"].width = 20
    buf = io.BytesIO()
    wb.save(buf)
    out = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(buf.getvalue())) as src, zipfile.ZipFile(out, "w") as dst:
        for info in src.infolist():
            data = src.read(info.filename)
            if info.filename == "xl/worksheets/sheet1.xml":
                data = data.replace(
                    b"</sheetData>", b"<!-- " + b"x" * (3 * 1024 * 1024) + b" --></sheetData>"
                )
            dst.writestr(info, data)
    body, _ = th(
        "a.xlsx", out.getvalue()
    )  # 시트 3MB — 거절 없음, 너비는 앞부분에서 읽힌다(20자 → 140px)
    assert body.startswith('<h2>S</h2><table><tr><th style="width:140px">')
    # (2) <col min=1 max=1048576> 을 수천 번 반복해도 열 상한에서 멈춘다(47초 → 즉시). 숨긴 열은 건너뛴다
    out = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(buf.getvalue())) as src, zipfile.ZipFile(out, "w") as dst:
        for info in src.infolist():
            data = src.read(info.filename)
            if info.filename == "xl/worksheets/sheet1.xml":
                cols = (
                    b'<col min="1" max="1" width="9" hidden="1"/>'
                    + b'<col min="1" max="1048576" width="9"/>' * 5000
                )
                data = re.sub(rb"<cols>.*?</cols>", b"<cols>" + cols + b"</cols>", data, flags=re.S)
            dst.writestr(info, data)
    body, _ = th("a.xlsx", out.getvalue())
    assert body.startswith('<h2>S</h2><table><tr><th style="width:63px">')
    # (3) 차트시트가 앞에 있어도 건너뛴다 — wb.worksheets 와 같은 순서가 된다
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        z.writestr(
            "xl/workbook.xml",
            '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            '<sheets><sheet name="Chart" sheetId="1" r:id="rId1"/><sheet name="S" sheetId="2" r:id="rId2"/></sheets></workbook>',
        )
        z.writestr(
            "xl/_rels/workbook.xml.rels",
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="x/chartsheet" Target="chartsheets/sheet1.xml"/>'
            '<Relationship Id="rId2" Type="x/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
        )
        z.writestr("xl/chartsheets/sheet1.xml", "<chartsheet/>")
        z.writestr(
            "xl/worksheets/sheet1.xml",
            '<worksheet><cols><col min="2" max="3" width="10"/></cols><sheetData/></worksheet>',
        )
    with zipfile.ZipFile(io.BytesIO(out.getvalue())) as z:
        assert convert._xlsx_col_widths(z) == [{2: 70, 3: 70}]
    # (4) hwpx: 기본 글자 모양과 같은 글꼴·크기는 두 번째 charPr 에서도 생략(base dict 를 먼저 지우던 버그), 실제 한글 파일의
    #     hp:switch/hp:default + hc: 여백, 기본 문단 모양의 줄 간격(160%)은 생략, hc:winBrush 배경
    hh = "http://www.hancom.co.kr/hwpml/2011/head"
    hc = "http://www.hancom.co.kr/hwpml/2011/core"
    header = (
        f'<hh:head xmlns:hh="{hh}" xmlns:hc="{hc}" xmlns:hp="{_HP}"><hh:refList>'
        '<hh:fontfaces><hh:fontface lang="HANGUL"><hh:font id="0" face="함초롬바탕"/></hh:fontface></hh:fontfaces>'
        '<hh:borderFills><hh:borderFill id="3"><hh:leftBorder type="SOLID"/><hc:fillBrush><hc:winBrush faceColor="#BFDBFE"/></hc:fillBrush></hh:borderFill></hh:borderFills>'
        '<hh:charProperties><hh:charPr id="0" height="1000" textColor="#000000" shadeColor="none"><hh:fontRef hangul="0"/></hh:charPr>'
        '<hh:charPr id="1" height="1000" textColor="#000000" shadeColor="none"><hh:fontRef hangul="0"/><hh:bold/></hh:charPr></hh:charProperties>'
        '<hh:paraProperties><hh:paraPr id="0"><hh:align horizontal="JUSTIFY"/><hp:switch><hp:case><hh:lineSpacing type="PERCENT" value="160"/></hp:case>'
        '<hp:default><hh:margin><hc:left value="0"/><hc:prev value="0"/></hh:margin><hh:lineSpacing type="PERCENT" value="160"/></hp:default></hp:switch></hh:paraPr>'
        '<hh:paraPr id="1"><hp:switch><hp:default><hh:margin><hc:left value="1500"/><hc:prev value="750"/></hh:margin><hh:lineSpacing type="PERCENT" value="200"/></hp:default></hp:switch></hh:paraPr>'
        "</hh:paraProperties></hh:refList></hh:head>"
    )
    section = (
        '<hp:p paraPrIDRef="0"><hp:run charPrIDRef="1"><hp:t>굵게만</hp:t></hp:run></hp:p>'
        '<hp:p paraPrIDRef="1"><hp:run charPrIDRef="0"><hp:t>들여쓴 넓은 줄</hp:t></hp:run></hp:p>'
        '<hp:p paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:tbl borderFillIDRef="3"><hp:tr><hp:tc borderFillIDRef="3"><hp:subList><hp:p><hp:run charPrIDRef="0"><hp:t>칸</hp:t></hp:run></hp:p></hp:subList></hp:tc></hp:tr></hp:tbl></hp:run></hp:p>'
    )
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        z.writestr("mimetype", "application/hwp+zip")
        z.writestr("Contents/header.xml", header)
        z.writestr(
            "Contents/section0.xml",
            f'<?xml version="1.0"?><hs:sec xmlns:hs="{_HS}" xmlns:hp="{_HP}">{section}</hs:sec>',
        )
    assert th("a.hwpx", out.getvalue())[0] == (
        '<p style="text-align:justify"><strong>굵게만</strong></p>'
        '<p style="line-height:2;margin-left:20px;margin-top:10px">들여쓴 넓은 줄</p>'
        '<table><tr><td style="background-color:#bfdbfe"><p>칸</p></td></tr></table>'
    )
    # (5) 글꼴 이름의 홑따옴표는 지운다(닫히지 않는 CSS 문자열 방지), 유니코드 숫자·긴 숫자는 거절 대신 무시
    assert convert._font("a'b c") == "'ab c'"
    body = (
        '<w:p><w:pPr><w:ind w:left="²"/></w:pPr><w:r><w:rPr><w:sz w:val="'
        + "9" * 5000
        + '"/></w:rPr><w:t>글</w:t></w:r></w:p>'
    )
    assert th("a.docx", make_docx(body))[0] == "<p>글</p>"
    # (6) 문단마다 직접 붙은 기본 줄 간격(docDefaults 와 같은 259)은 생략, 일부 변만 none 인 TableGrid 표는 테두리 있음
    styles = f'<w:styles {_WNS}><w:docDefaults><w:pPrDefault><w:pPr><w:spacing w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults></w:styles>'
    body = (
        '<w:p><w:pPr><w:spacing w:line="259" w:lineRule="auto"/></w:pPr><w:r><w:t>a</w:t></w:r></w:p>'
        '<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblBorders><w:top w:val="none"/></w:tblBorders></w:tblPr><w:tr><w:tc><w:p><w:r><w:t>x</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
    )
    out = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(make_docx(body))) as src, zipfile.ZipFile(out, "w") as dst:
        for info in src.infolist():
            if info.filename != "word/styles.xml":
                dst.writestr(info, src.read(info.filename))
        dst.writestr("word/styles.xml", styles)
    assert (
        th("a.docx", out.getvalue())[0]
        == '<p>a</p><table><tr><td style="border-top:none"><p>x</p></td></tr></table>'
    )  # 표는 테두리 있음(스타일이 그린다), 지운 윗변만 칸 변으로(서식 4차)
    # (7) 병합 칸(colspan>1)엔 colwidth 를 싣지 않는다
    frag = ydoc_fragment(
        ydoc.build('<table><tr><td colspan="2" style="width:120px"><p>a</p></td></tr></table>', "t")
    )
    assert "colwidth" not in frag and 'colspan="2"' in frag


def test_fmt3_theme_fonts_are_document_default() -> None:
    """실제 워드 파일(시말서.docx 대조): docDefaults 는 글꼴 이름 대신 테마(`minorEastAsia`)를 가리키고 theme1.xml 이 맑은 고딕을
    준다. 본문 run 의 명시적 맑은 고딕은 기본값과 같으니 싣지 않고, 다른 글꼴만 마크가 된다."""
    styles = (
        f"<w:styles {_WNS}><w:docDefaults><w:rPrDefault><w:rPr>"
        '<w:rFonts w:asciiTheme="minorHAnsi" w:eastAsiaTheme="minorEastAsia" w:hAnsiTheme="minorHAnsi"/><w:sz w:val="22"/>'
        "</w:rPr></w:rPrDefault></w:docDefaults></w:styles>"
    )
    theme = (
        '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements><a:fontScheme name="Office">'
        '<a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:font script="Hang" typeface="맑은 고딕"/></a:majorFont>'
        '<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:font script="Hang" typeface="맑은 고딕"/></a:minorFont>'
        "</a:fontScheme></a:themeElements></a:theme>"
    )
    body = (
        '<w:p><w:r><w:rPr><w:rFonts w:ascii="맑은 고딕" w:eastAsia="맑은 고딕" w:hAnsi="맑은 고딕"/><w:sz w:val="22"/></w:rPr><w:t>기본 </w:t></w:r>'
        '<w:r><w:rPr><w:rFonts w:eastAsiaTheme="majorEastAsia"/></w:rPr><w:t>테마 제목 글꼴 </w:t></w:r>'
        '<w:r><w:rPr><w:rFonts w:eastAsia="돋움"/></w:rPr><w:t>돋움</w:t></w:r></w:p>'
    )
    buf = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(make_docx(body))) as src, zipfile.ZipFile(buf, "w") as dst:
        for info in src.infolist():
            if info.filename != "word/styles.xml":
                dst.writestr(info, src.read(info.filename))
        dst.writestr("word/styles.xml", styles)
        dst.writestr("word/theme/theme1.xml", theme)
    # majorEastAsia 도 Hang 이 맑은 고딕이라 기본과 같다 → 생략. 돋움만 남는다
    assert (
        th("a.docx", buf.getvalue())[0]
        == '<p>기본 테마 제목 글꼴 <span style="font-family:돋움">돋움</span></p>'
    )


def test_fmt4_docx_nested_table_row_height_cell_borders() -> None:
    """서식 4차(README 64, 실제 지출품의서 대조): 칸 안의 표(결재란)는 바깥 표 바로 뒤로 꺼내고(편집기 셀은 문단만),
    행 높이(trHeight twip÷15)와 칸 변 테두리(tcBorders, 없으면 tblBorders 의 바깥 변/inside*)를 계약 값으로 싣는다."""
    grey = 'w:val="single" w:color="BFBFBF" w:sz="6"'
    inner_tbl = (
        '<w:tbl><w:tblPr><w:tblBorders><w:top w:val="none"/><w:left w:val="none"/><w:bottom w:val="none"/><w:right w:val="none"/></w:tblBorders></w:tblPr>'
        '<w:tr><w:trPr><w:trHeight w:val="800" w:hRule="exact"/></w:trPr>'
        f'<w:tc><w:tcPr><w:tcBorders><w:top {grey}/><w:left w:val="none"/><w:bottom {grey}/><w:right w:val="none"/></w:tcBorders></w:tcPr><w:p><w:r><w:t>담당</w:t></w:r></w:p></w:tc>'
        f'<w:tc><w:tcPr><w:tcBorders><w:top {grey}/><w:start w:val="dotted" w:color="BFBFBF" w:sz="6"/><w:bottom {grey}/><w:end w:val="none"/></w:tcBorders></w:tcPr><w:p/></w:tc>'
        "</w:tr></w:tbl>"
    )
    layout = (
        '<w:tbl><w:tblPr><w:tblBorders><w:top w:val="none"/><w:left w:val="none"/><w:bottom w:val="none"/><w:right w:val="none"/>'
        '<w:insideH w:val="none"/><w:insideV w:val="none"/></w:tblBorders></w:tblPr>'
        f"<w:tr><w:tc><w:p><w:r><w:t>지출품의서</w:t></w:r></w:p></w:tc><w:tc>{inner_tbl}<w:p/></w:tc></w:tr></w:tbl>"
    )
    assert th("a.docx", make_docx(layout))[0] == (
        '<table data-borders="none"><tr><td><p>지출품의서</p></td><td><p></p></td></tr></table>'
        # 꺼낸 안쪽 표: 800 twip = 53px, sz 6(1/8pt) = 1px, start/end 도 left/right 로. 테두리 없는 표라 none 변은 싣지 않는다
        '<table data-borders="none"><tr style="height:53px">'
        '<td style="border-top:1px solid #bfbfbf;border-bottom:1px solid #bfbfbf"><p>담당</p></td>'
        '<td style="border-top:1px solid #bfbfbf;border-bottom:1px solid #bfbfbf;border-left:1px dotted #bfbfbf"><p></p></td>'
        "</tr></table>"
    )

    # 표 테두리(tblBorders): 바깥 변은 top/left/bottom/right, 안쪽 선은 insideH(가로)·insideV(세로). 편집기 기본 선과 같은 값(single·auto·≤1px)은 생략
    def cell(text: str) -> str:
        return f"<w:tc><w:p><w:r><w:t>{text}</w:t></w:r></w:p></w:tc>"

    bordered = (
        '<w:tbl><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:color="auto"/><w:left w:val="single" w:sz="4"/>'
        '<w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/>'
        '<w:insideH w:val="single" w:color="FFFFFF" w:sz="12"/><w:insideV w:val="dashed" w:color="FF0000" w:sz="18"/></w:tblBorders></w:tblPr>'
        f"<w:tr>{cell('a')}{cell('b')}</w:tr><w:tr>{cell('c')}{cell('d')}</w:tr></w:tbl>"
    )
    assert th("a.docx", make_docx(bordered))[0] == (
        "<table><tr>"
        '<td style="border-right:3px dashed #ff0000;border-bottom:2px solid #ffffff"><p>a</p></td>'
        '<td style="border-bottom:2px solid #ffffff;border-left:3px dashed #ff0000"><p>b</p></td></tr>'
        '<tr><td style="border-top:2px solid #ffffff;border-right:3px dashed #ff0000"><p>c</p></td>'
        '<td style="border-top:2px solid #ffffff;border-left:3px dashed #ff0000"><p>d</p></td></tr></table>'
    )
    # 세로 병합: 아래 변은 마지막(이어지는) 칸의 tcBorders 로 — 시작 칸은 solid, 끝 칸은 dashed 면 dashed(리뷰).
    # 이어지는 칸뿐인 행은 출력에서 사라지므로 rowspan 도 1 로 돌아온다(Codex)
    merged = (
        '<w:tbl><w:tr><w:tc><w:tcPr><w:vMerge w:val="restart"/><w:tcBorders><w:bottom w:val="single" w:sz="12"/></w:tcBorders></w:tcPr><w:p><w:r><w:t>a</w:t></w:r></w:p></w:tc></w:tr>'
        '<w:tr><w:tc><w:tcPr><w:vMerge/><w:tcBorders><w:bottom w:val="dashed" w:sz="12"/></w:tcBorders></w:tcPr><w:p/></w:tc></w:tr></w:tbl>'
    )
    assert (
        th("a.docx", make_docx(merged))[0]
        == '<table data-borders="none"><tr><td style="border-bottom:2px dashed #000000"><p>a</p></td></tr></table>'
    )
    # 위·아래 선만 적힌 표(tblStyle 없음): 적히지 않은 변은 워드가 안 그린다 → none. gridBefore 1 인 둘째 행의 칸은 안쪽(insideV)·오른쪽 바깥.
    # tblGrid 가 열 수. 선 종류 thinThickSmallGap → double
    lines = (
        '<w:tbl><w:tblPr><w:tblBorders><w:top w:val="thinThickSmallGap" w:sz="12"/><w:bottom w:val="single" w:sz="12"/>'
        '<w:insideV w:val="dotDash" w:sz="4" w:color="00FF00"/></w:tblBorders></w:tblPr>'
        "<w:tblGrid><w:gridCol/><w:gridCol/></w:tblGrid>"
        f'<w:tr>{cell("a")}{cell("b")}</w:tr><w:tr><w:trPr><w:gridBefore w:val="1"/></w:trPr>{cell("c")}</w:tr></w:tbl>'
    )
    assert (
        th("a.docx", make_docx(lines))[0]
        == (
            '<table><tr><td style="border-top:2px double #000000;border-right:1px dashed #00ff00;border-bottom:none;border-left:none"><p>a</p></td>'
            '<td style="border-top:2px double #000000;border-right:none;border-bottom:none;border-left:1px dashed #00ff00"><p>b</p></td></tr>'
            '<tr><td style="border-top:none;border-right:none;border-bottom:none;border-left:none"><p></p></td>'  # 빈자리엔 선이 없다
            '<td style="border-top:none;border-right:none;border-bottom:2px solid #000000;border-left:1px dashed #00ff00"><p>c</p></td></tr></table>'
        )
    )


def test_fmt4_hwpx_nested_table_row_height_cell_borders() -> None:
    """hwpx: 행 높이는 그 행 칸들의 cellSz height 최대(HWPUNIT÷75), 칸 변은 borderFill 의 *Border(type·width mm·color),
    칸 안의 표는 바깥 표 뒤로."""
    hh = "http://www.hancom.co.kr/hwpml/2011/head"
    header = (
        f'<hh:head xmlns:hh="{hh}"><hh:refList><hh:borderFills>'
        '<hh:borderFill id="1"><hh:leftBorder type="NONE"/><hh:rightBorder type="NONE"/><hh:topBorder type="NONE"/><hh:bottomBorder type="NONE"/></hh:borderFill>'
        '<hh:borderFill id="2"><hh:leftBorder type="DOT" width="0.12 mm" color="#9CCFE0"/><hh:rightBorder type="NONE"/>'
        '<hh:topBorder type="NONE"/><hh:bottomBorder type="SOLID" width="0.4 mm" color="#5FB3D0"/></hh:borderFill>'
        "</hh:borderFills></hh:refList></hh:head>"
    )
    inner = (  # 안쪽 표는 선이 있다(borderFill 2) — 바깥 표의 테두리 없음 판정에 끼어들면 안 된다(리뷰)
        '<hp:tbl borderFillIDRef="2"><hp:tr><hp:tc borderFillIDRef="2"><hp:subList><hp:p><hp:run charPrIDRef="0"><hp:t>내부</hp:t></hp:run></hp:p></hp:subList></hp:tc></hp:tr></hp:tbl>'
    )
    section = (
        '<hp:p paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:tbl borderFillIDRef="1"><hp:tr>'
        f'<hp:tc borderFillIDRef="2"><hp:cellSz width="7500" height="1500"/><hp:subList><hp:p><hp:run charPrIDRef="0"><hp:t>칸</hp:t>{inner}</hp:run></hp:p></hp:subList></hp:tc>'
        '<hp:tc borderFillIDRef="2"><hp:cellSpan colSpan="1" rowSpan="2"/><hp:cellSz width="7500" height="3000"/><hp:subList><hp:p><hp:run charPrIDRef="0"><hp:t>둘</hp:t></hp:run></hp:p></hp:subList></hp:tc>'
        "</hp:tr></hp:tbl></hp:run></hp:p>"
    )
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("mimetype", "application/hwp+zip")
        z.writestr("Contents/header.xml", header)
        z.writestr(
            "Contents/section0.xml",
            f'<?xml version="1.0"?><hs:sec xmlns:hs="{_HS}" xmlns:hp="{_HP}">{section}</hs:sec>',
        )
    side = "border-top:none;border-right:none;border-bottom:2px solid #5fb3d0;border-left:1px dotted #9ccfe0"
    assert th("a.hwpx", buf.getvalue())[0] == (
        # 세로 병합 칸(rowSpan 2, 3000)은 행 높이에 안 센다 → 1500 = 20px. 0.12mm → 1px(최소), 0.4mm → 2px. 표에 선이 있으니 none 도 싣는다
        f'<table><tr style="height:20px"><td style="width:100px;{side}"><p>칸</p></td>'
        f'<td rowspan="2" style="width:100px;{side}"><p>둘</p></td></tr></table>'
        f'<table><tr><td style="{side}"><p>내부</p></td></tr></table>'
    )
    # 바깥 표와 직속 칸이 다 선 없음이면, 안쪽 표에 선이 있어도 바깥 표는 테두리 없음
    layout = (  # 바깥 두 칸만 선 없음(1)으로, 안쪽 표는 그대로 선 있음(2)
        section.replace(inner, "@INNER@")
        .replace('<hp:tc borderFillIDRef="2">', '<hp:tc borderFillIDRef="1">')
        .replace("@INNER@", inner)
    )
    buf2 = io.BytesIO()
    with zipfile.ZipFile(buf2, "w") as z:
        z.writestr("mimetype", "application/hwp+zip")
        z.writestr("Contents/header.xml", header)
        z.writestr(
            "Contents/section0.xml",
            f'<?xml version="1.0"?><hs:sec xmlns:hs="{_HS}" xmlns:hp="{_HP}">{layout}</hs:sec>',
        )
    assert th("a.hwpx", buf2.getvalue())[0].startswith(
        '<table data-borders="none"><tr style="height:20px"><td style="width:100px"><p>칸</p></td>'
    )


def test_fmt4_filter_and_ydoc_row_height_cell_borders() -> None:
    f = convert._Filter()
    f.feed(
        '<table><tr style="height: 40px; color: red"><td style="border-top: none; border-left: 2px dashed #9CCFE0; border-right: 9px solid #000; '
        'border-bottom: 1px wavy #000; border-top: 1px solid #ABC">x</td></tr><tr style="height:99999px"><td style="border-left:url(x)">y</td></tr></table>'
    )
    f.close()
    assert f.result() == (
        # 상한 밖 굵기(9px)·모르는 선 종류(wavy)·url 은 버림, 같은 변이 두 번이면 마지막 것, 색은 소문자 6자리
        '<table><tr style="height:40px"><td style="border-top:1px solid #aabbcc;border-left:2px dashed #9ccfe0">x</td></tr><tr><td>y</td></tr></table>',
        False,
    )
    f = convert._Filter()
    f.feed(
        '<table><tr style="height:١٢px"><td style="width:١٢px">u</td></tr></table>'
    )  # 아라비아 숫자는 숫자가 아니다(리뷰)
    f.close()
    assert f.result() == ("<table><tr><td>u</td></tr></table>", False)
    frag = ydoc_fragment(
        ydoc.build(
            '<table><tr style="height:40px"><td style="border-top:none;border-left:1px dotted #9ccfe0"><p>x</p></td></tr></table>',
            "t",
        )
    )
    assert frag == (
        '<table><tableRow height="40"><tableCell borderLeft="1px dotted #9ccfe0" borderTop="none"><paragraph>x</paragraph></tableCell></tableRow></table>'
    )


def test_docx_grid_codex_regressions() -> None:
    """#585 Codex 리뷰(머지 뒤 도착) — 워드 격자: (1) gridBefore 자리는 빈 칸으로 내야 다음 칸이 제 열에 선다,
    (2) continue 만 있는 행은 출력에서 사라지므로 그 행을 세던 rowspan 도 줄여야 아래 행을 덮지 않는다,
    (3) 칸이 빠진 행을 지나면 병합은 끝나고, 열린 병합이 없는 continue 는 보통 칸이다."""

    def cell(text: str, pr: str = "") -> str:
        body = f"<w:p><w:r><w:t>{text}</w:t></w:r></w:p>" if text else "<w:p/>"
        return f"<w:tc>{f'<w:tcPr>{pr}</w:tcPr>' if pr else ''}{body}</w:tc>"

    restart = '<w:vMerge w:val="restart"/>'
    # (2) restart A / continue 뿐인 행 / B — A 는 제 행만, B 는 따로. insideH(파랑)가 A 의 아래 변
    rows = (
        '<w:tbl><w:tblPr><w:tblBorders><w:bottom w:val="single" w:sz="12" w:color="FF0000"/><w:insideH w:val="single" w:sz="12" w:color="0000FF"/></w:tblBorders></w:tblPr>'
        f"<w:tr>{cell('A', restart)}</w:tr><w:tr>{cell('', '<w:vMerge/>')}</w:tr><w:tr>{cell('B')}</w:tr></w:tbl>"
    )
    assert th("a.docx", make_docx(rows))[0] == (
        '<table><tr><td style="border-top:none;border-right:none;border-bottom:2px solid #0000ff;border-left:none"><p>A</p></td></tr>'
        '<tr><td style="border-top:2px solid #0000ff;border-right:none;border-bottom:2px solid #ff0000;border-left:none"><p>B</p></td></tr></table>'
    )
    # (1)+(3) 1행 A(restart)·X, 2행 gridBefore=1 Y, 3행 continue(열린 병합 없음 → 보통 칸) Z·W
    rows = (
        f"<w:tbl><w:tr>{cell('A', restart)}{cell('X')}</w:tr>"
        f'<w:tr><w:trPr><w:gridBefore w:val="1"/></w:trPr>{cell("Y")}</w:tr>'
        f"<w:tr>{cell('Z', '<w:vMerge/>')}{cell('W')}</w:tr></w:tbl>"
    )
    assert th("a.docx", make_docx(rows))[0] == (
        '<table data-borders="none"><tr><td><p>A</p></td><td><p>X</p></td></tr>'
        "<tr><td><p></p></td><td><p>Y</p></td></tr>"
        "<tr><td><p>Z</p></td><td><p>W</p></td></tr></table>"
    )
    # continue 가 새 병합의 시작이 되지 않는다: 행2 의 Z(continue, 열린 병합 없음) 뒤 행3 의 continue 도 보통 칸
    rows = f"<w:tbl><w:tr>{cell('A', '<w:vMerge/>')}</w:tr><w:tr>{cell('B', '<w:vMerge/>')}</w:tr></w:tbl>"
    assert th("a.docx", make_docx(rows))[0] == (
        '<table data-borders="none"><tr><td><p>A</p></td></tr><tr><td><p>B</p></td></tr></table>'
    )
    # 칸 상한: gridBefore 63 만 있는 빈 행 수천 개(82바이트씩)가 칸 수천 개로 불어나던 것 — MAX_CELLS 에서 끊고 truncated(리뷰)
    row = '<w:tr><w:trPr><w:gridBefore w:val="63"/><w:gridAfter w:val="63"/></w:trPr></w:tr>'
    t0 = time.monotonic()
    c = convert.to_html(
        "a.docx", make_docx("<w:p><w:r><w:t>x</w:t></w:r></w:p><w:tbl>" + row * 3000 + "</w:tbl>")
    )
    assert c.truncated and c.html.count("<td>") <= convert.MAX_CELLS and time.monotonic() - t0 < 5
    # Y.Doc 에서도 열이 맞는다(빈 칸이 첫 열)
    frag = ydoc_fragment(
        ydoc.build(
            "<table><tr><td><p>A</p></td><td><p>X</p></td></tr><tr><td><p></p></td><td><p>Y</p></td></tr></table>",
            "t",
        )
    )
    assert (
        "<tableRow><tableCell><paragraph></paragraph></tableCell><tableCell><paragraph>Y</paragraph></tableCell></tableRow>"
        in frag
    )


# ── 구형 hwp(README 65) — pyhwp 컨테이너가 돌려준 `hwp5proc xml` 모양을 그대로 흉내 낸다(실제 파일 4개로 구조 확인)


def make_hwp5_xml(body: str, bindata: str = "", styles: str = "") -> str:
    styles = styles or '<Style name="Normal" parashape-id="0" charshape-id="0"/>'
    return (
        '<HwpDoc version="5.1.0.1"><DocInfo><IdMappings ko-fonts="2" en-fonts="1" charshapes="3" parashapes="2" borderfills="2" bindata="1">'
        '<FaceName name="함초롬바탕"/><FaceName name="나눔스퀘어"/><FaceName name="Arial"/>'  # ko 2 + en 1
        '<CharShape basesize="1000" bold="0" italic="0" underline="none" text-color="#000000" shade-color="#ffffff"><FontFace ko="0" en="0"/></CharShape>'
        '<CharShape basesize="1600" bold="1" italic="0" underline="underline" text-color="#FF0000" shade-color="#FEF08A"><FontFace ko="1" en="0"/></CharShape>'
        '<CharShape basesize="1000" bold="0" italic="1" underline="none" text-color="#000000" shade-color="#ffffff"><FontFace ko="0" en="0"/></CharShape>'
        '<ParaShape align="both" linespacing-type="ratio" linespacing="160" doubled-margin-left="0" doubled-margin-top="0" doubled-margin-bottom="0" head-shape="none" level="0"/>'
        '<ParaShape align="center" linespacing-type="ratio" linespacing="200" doubled-margin-left="3000" doubled-margin-top="1500" doubled-margin-bottom="0" head-shape="outline" level="0"/>'
        '<BorderFill colorpattern="0" fillflags="00000000"><Border stroke-type="none" width="0.1mm" color="#000000" attribute-name="left"/><Border stroke-type="none" width="0.1mm" color="#000000" attribute-name="right"/>'
        '<Border stroke-type="none" width="0.1mm" color="#000000" attribute-name="top"/><Border stroke-type="none" width="0.1mm" color="#000000" attribute-name="bottom"/><FillColorPattern background-color="#ffffff"/></BorderFill>'
        '<BorderFill colorpattern="1" fillflags="00000001"><Border stroke-type="dotted" width="0.12mm" color="#9CCFE0" attribute-name="left"/><Border stroke-type="none" width="0.1mm" color="#000000" attribute-name="right"/>'
        '<Border stroke-type="none" width="0.1mm" color="#000000" attribute-name="top"/><Border stroke-type="solid" width="0.4mm" color="#5FB3D0" attribute-name="bottom"/><FillColorPattern background-color="#DDF2F8"/></BorderFill>'
        f"{bindata}{styles}"
        f"</IdMappings></DocInfo><BodyText><SectionDef><ColumnSet>{body}</ColumnSet></SectionDef></BodyText></HwpDoc>"
    )


def hwp5_p(inner: str, ps: str = "0") -> str:
    return f'<Paragraph parashape-id="{ps}"><LineSeg>{inner}<ControlChar name="PARAGRAPH_BREAK"/></LineSeg></Paragraph>'


def test_hwp5_text_fonts_spacing(monkeypatch) -> None:
    """바탕글(Style 0)의 글꼴·크기·줄 간격(160%)은 싣지 않고, 다른 것만. 개요 문단은 h1, 여백은 두 배 HWPUNIT÷2÷75."""
    body = (
        hwp5_p(
            '<Text charshape-id="0">기본 </Text><Text charshape-id="1">큰 스퀘어</Text><ControlChar name="TAB"/><Text charshape-id="2">기울임</Text>'
            '<ControlChar name="FIELD_START"/><FieldFormula><Text charshape-id="0"> 합계 </Text><ControlChar name="NONBREAK_SPACE"/><Text charshape-id="0">264,800</Text></FieldFormula><ControlChar name="FIELD_END"/>'
        )
        + hwp5_p(
            '<Text charshape-id="0">제목</Text><ControlChar name="LINE_BREAK"/><Text charshape-id="0">둘째 줄</Text>',
            ps="1",
        )
        + '<Paragraph parashape-id="0"><LineSeg><ControlChar name="PARAGRAPH_BREAK"/></LineSeg></Paragraph>'
    )
    root = ET.fromstring(make_hwp5_xml(body))
    monkeypatch.setattr(convert, "_hwp5_xml", lambda data: root)
    assert (
        convert.to_html("a.hwp", b"\xd0\xcf\x11\xe0" + b"x").html
        == (
            '<p style="text-align:justify">기본 <span style="color:#ff0000;font-family:나눔스퀘어;font-size:16pt"><mark data-color="#fef08a"><u><strong>큰 스퀘어</strong></u></mark></span> <em>기울임</em> 합계  264,800</p>'  # 계산식(FieldFormula) 안의 글자(합계)도 글자로, 필드 시작/끝 제어문자는 버린다(리뷰)
            '<h1 style="text-align:center;line-height:2;margin-left:20px;margin-top:10px">제목<br>둘째 줄</h1>'
            "<p></p>"
        )
    )


def test_hwp5_table_picture_nested(monkeypatch) -> None:
    """표: 행 높이는 칸 height 최대(세로 병합 제외), 칸 테두리·배경은 borderfill-id(1-based), 칸 안의 표는 뒤로. 그림은 BinData base64."""
    png = base64.b64encode(png_1x1()).decode()
    bindata = f'<BinData storage="embedding"><BinDataEmbedding storage-id="BIN0001" ext="png">{png}</BinDataEmbedding></BinData>'
    inner_tbl = (
        '<TableControl><TableBody rows="1" cols="1" borderfill-id="1"><TableRow><TableCell col="0" row="0" colspan="1" rowspan="1" width="7500" height="750" borderfill-id="1">'
        + hwp5_p('<Text charshape-id="0">내부</Text>')
        + "</TableCell></TableRow></TableBody></TableControl>"
    )
    table = (
        '<TableControl><TableBody rows="2" cols="2" borderfill-id="1"><TableRow>'
        '<TableCell col="0" row="0" colspan="1" rowspan="1" width="7500" height="1500" borderfill-id="2">'
        + hwp5_p(f'<Text charshape-id="0">칸</Text>{inner_tbl}')
        + '</TableCell><TableCell col="1" row="0" colspan="1" rowspan="2" width="7500" height="3000" borderfill-id="2">'
        + hwp5_p('<Text charshape-id="0">둘</Text>')
        + "</TableCell></TableRow><TableRow></TableRow></TableBody></TableControl>"
    )
    pic = '<GShapeObjectControl width="7500" height="3000"><ShapeComponent><ShapePicture><PictureInfo bindata-id="1"/></ShapePicture></ShapeComponent></GShapeObjectControl>'
    bad = '<GShapeObjectControl width="750"><ShapeComponent><ShapePicture><PictureInfo bindata-id="7"/></ShapePicture></ShapeComponent></GShapeObjectControl>'
    body = hwp5_p(
        f'<Text charshape-id="0">앞</Text>{table}<Text charshape-id="0">뒤</Text>{pic}{pic}{bad}{bad}'
    )
    root = ET.fromstring(make_hwp5_xml(body, bindata))
    monkeypatch.setattr(convert, "_hwp5_xml", lambda data: root)
    calls = []
    real = base64.b64decode
    monkeypatch.setattr(convert.base64, "b64decode", lambda b: calls.append(1) or real(b))
    c = convert.to_html("a.hwp", b"\xd0\xcf\x11\xe0" + b"x")
    side = "border-top:none;border-right:none;border-bottom:2px solid #5fb3d0;border-left:1px dotted #9ccfe0"
    assert (
        c.html
        == (
            '<p style="text-align:justify">앞</p>'
            f'<table><tr style="height:20px"><td style="background-color:#ddf2f8;width:100px;{side}"><p style="text-align:justify">칸</p></td>'
            f'<td rowspan="2" style="background-color:#ddf2f8;width:100px;{side}"><p style="text-align:justify">둘</p></td></tr><tr></tr></table>'
            '<table data-borders="none"><tr style="height:10px"><td style="width:100px"><p style="text-align:justify">내부</p></td></tr></table>'
            '<p style="text-align:justify">뒤</p><img data-ref="0" width="100"><img data-ref="0" width="100">'  # 두 번째는 다시 풀지 않고 번호만
        )
    )
    assert len(c.images) == 1 and c.images[0][1] == "image/png"
    assert len(calls) == 1  # 같은 그림 두 번·없는 그림 두 번 → 디코딩은 한 번(리뷰)


def test_hwp5_guards(monkeypatch) -> None:
    """HWP_URL 이 없으면 미지원(hwpx 로 저장 안내), OLE 서명이 아니면 보내지 않는다, 변환기에 못 닿으면 HwpUnavailable."""
    import httpx

    monkeypatch.setattr(convert.settings, "hwp_url", None)
    with pytest.raises(Unsupported):
        convert.to_html("a.hwp", b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"x" * 100)
    monkeypatch.setattr(convert.settings, "hwp_url", "http://hwp:8080")
    with pytest.raises(Unsupported):
        convert.to_html("a.hwp", b"PK\x03\x04" + b"x" * 100)  # zip 이지 OLE 가 아니다

    def boom(*a, **k):
        raise httpx.ConnectError("down")

    monkeypatch.setattr(convert.httpx, "stream", boom)
    with pytest.raises(convert.HwpUnavailable):
        convert.to_html("a.hwp", b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"x" * 100)
    # 변환기 응답별: 504 → 시간 초과(422 「너무 오래」), 200 아님 → 형식 오류, 상한 초과 → TooLarge, DOCTYPE → 거부, 정상 → 루트
    import xml.etree.ElementTree as ET2

    def serve(resp: httpx.Response):
        client = httpx.Client(transport=httpx.MockTransport(lambda req: resp))
        monkeypatch.setattr(
            convert.httpx, "stream", lambda method, url, **kw: client.stream(method, url, **kw)
        )

    ole = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"x" * 100
    serve(httpx.Response(504))
    with pytest.raises(TimeoutError):
        convert._hwp5_xml(ole)
    serve(httpx.Response(422, content=b"not hwp5"))
    with pytest.raises(Unsupported):
        convert._hwp5_xml(ole)
    monkeypatch.setattr(convert, "MAX_HWP5_XML_BYTES", 64)
    serve(httpx.Response(200, content=b"<HwpDoc>" + b"<a/>" * 100 + b"</HwpDoc>"))
    with pytest.raises(convert.TooLarge):
        convert._hwp5_xml(ole)
    monkeypatch.setattr(convert, "MAX_HWP5_XML_BYTES", 1 << 20)
    serve(httpx.Response(200, content=b'<!DOCTYPE x [<!ENTITY a "b">]><HwpDoc>&a;</HwpDoc>'))
    with pytest.raises(Unsupported):
        convert._hwp5_xml(ole)
    serve(httpx.Response(200, content=b"<HwpDoc><DocInfo/><BodyText/></HwpDoc>"))
    assert (
        isinstance(convert._hwp5_xml(ole), ET2.Element) and convert._hwp5_xml(ole).tag == "HwpDoc"
    )
    # 빈 행·DocInfo 없는 XML 은 형식 오류
    monkeypatch.setattr(convert, "_hwp5_xml", lambda data: ET.fromstring("<HwpDoc/>"))
    with pytest.raises(Unsupported):
        convert.to_html("a.hwp", b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"x" * 100)


async def _import(client: AsyncClient, name: str, data: bytes, **form):
    return await client.post(
        "/api/docs/import",
        files={"file": (name, data, "application/octet-stream")},
        data=form,
        headers=csrf(client),
    )


async def test_import_route(
    client: AsyncClient, users: Users, app_db, minio_bucket, monkeypatch
) -> None:
    root = await _root(app_db)
    await app_db.commit()
    assert (await _import(client, "a.docx", DOCX, folder_id=str(root.id))).status_code == 401
    await login(client, "sujin@zenith.co.kr")

    r = await _import(client, "기획서.docx", DOCX, folder_id=str(root.id))
    assert r.status_code == 201, r.text
    body = r.json()
    assert set(body) == {"doc", "truncated", "file"}
    assert (body["doc"]["title"], body["doc"]["folder_id"], body["truncated"]) == (
        "기획서",
        str(root.id),
        False,
    )
    # 본문은 서버가 Y.Doc 으로 심었다(README 61) — 열지 않아도 있고, 평문·tsv 도 바로 파생된다
    doc = await app_db.get(Document, body["doc"]["id"], populate_existing=True)
    assert doc is not None and doc.ydoc_snapshot
    assert doc.text_cache is not None and "제목 하나" in doc.text_cache and "굵게" in doc.text_cache
    frag = ydoc_fragment(doc.ydoc_snapshot)
    assert frag.startswith(
        '<heading level="1">제목 하나</heading><paragraph>보통 <bold>굵게</bold>'
    )
    chip = frag[frag.rindex("<paragraph><fileChip ") :]  # 속성 출력 순서는 고정이 아니다
    assert chip.endswith("></fileChip></paragraph>")
    for attr in (
        'name="기획서.docx"',
        f'size="{body["file"]["size"]}"',
        f'src="{body["file"]["url"]}"',
    ):
        assert attr in chip
    r = await client.get(
        f"/api/docs/{body['doc']['id']}"
    )  # 초기 로드 — 프론트가 이 상태로 방을 연다
    assert r.status_code == 200 and r.json()["ydoc"] is not None
    row = await app_db.get(StoredFile, body["file"]["id"])
    assert (row.doc_id, row.uploader_id, row.content_type) == (
        doc.id,
        users.member.id,
        "application/octet-stream",
    )
    r = await client.get(body["file"]["url"])  # 원본 내려받기 — 첨부로
    assert r.status_code == 200 and r.content == DOCX
    assert r.headers["content-disposition"].startswith("attachment")

    # 422: 형식·빈 파일·없는(못 보는) 폴더. 문서가 생기지 않는다
    before = (await app_db.execute(select(Document))).scalars().all()
    r = await _import(client, "a.pptx", b"PK\x03\x04 x", folder_id=str(root.id))
    assert (r.status_code, r.json()["code"]) == (422, "VALIDATION") and "hwpx" in r.json()["detail"]
    r = await _import(client, "a.docx", b"", folder_id=str(root.id))
    assert r.status_code == 422
    r = await _import(client, "a.docx", DOCX, folder_id=str(uuid.uuid4()))
    assert (r.status_code, r.json()["detail"]) == (422, "없는 폴더입니다.")
    assert len((await app_db.execute(select(Document))).scalars().all()) == len(before)

    # 503: 변환기(infra/hwp) 불통 — 파일 탓이 아니라 HWP_UNAVAILABLE, 감사는 docs.import_unavailable(하루 상한에 안 센다)
    def down(name, data):
        raise convert.HwpUnavailable()

    monkeypatch.setattr(convert, "to_html", down)
    r = await _import(client, "a.hwp", b"\xd0\xcf\x11\xe0" + b"x" * 64, folder_id=str(root.id))
    assert (r.status_code, r.json()["code"]) == (503, "HWP_UNAVAILABLE")
    monkeypatch.setattr(convert, "to_html", _real_to_html)
    kinds = [
        e.kind
        for e in (
            await app_db.execute(select(AuditEvent).where(AuditEvent.kind.like("docs.import_%")))
        ).scalars()
    ]
    assert kinds.count("docs.import_unavailable") == 1

    # 그림이 든 파일 — 그림도 그 문서의 첨부로 올라가고(감사 1건씩) imageBlock 이 그 주소를 가리킨다
    r = await _import(client, "그림.docx", make_rich_docx(), folder_id=str(root.id))
    assert r.status_code == 201, r.text
    rich = r.json()
    rows = (
        (
            await app_db.execute(
                select(StoredFile).where(StoredFile.doc_id == uuid.UUID(rich["doc"]["id"]))
            )
        )
        .scalars()
        .all()
    )
    kinds = sorted((f.name, f.content_type) for f in rows)
    assert kinds == [("그림-1.png", "image/png"), ("그림.docx", "application/octet-stream")]
    img_row = next(f for f in rows if f.content_type == "image/png")
    rdoc = await app_db.get(Document, rich["doc"]["id"], populate_existing=True)
    assert f'<imageBlock src="/api/files/{img_row.id}" width="200"></imageBlock>' in ydoc_fragment(
        rdoc.ydoc_snapshot
    )
    r = await client.get(f"/api/files/{img_row.id}")
    assert r.status_code == 200 and r.content == png_1x1()
    assert r.headers["content-type"].startswith("image/png")

    # 감사 기록에 문서 id, xlsx·hwpx 도 같은 경로로, 끊기면 truncated
    audits = (
        (await app_db.execute(select(AuditEvent).where(AuditEvent.kind == "files.uploaded")))
        .scalars()
        .all()
    )
    assert sorted(a.detail["doc"] for a in audits) == sorted(
        [body["doc"]["id"], rich["doc"]["id"], rich["doc"]["id"]]
    )
    r = await _import(client, "표.xlsx", make_xlsx(), folder_id=str(root.id))
    assert r.status_code == 201
    xdoc = await app_db.get(Document, r.json()["doc"]["id"], populate_existing=True)
    assert ydoc_fragment(xdoc.ydoc_snapshot).startswith(
        '<heading level="2">매출</heading><table><tableRow><tableHeader><paragraph>이름</paragraph></tableHeader>'
    )
    monkeypatch.setattr(convert, "MAX_SEED_COST", 200)
    long_hwpx = make_hwpx("<hp:p><hp:run><hp:t>" + "가" * 300 + "</hp:t></hp:run></hp:p>")
    r = await _import(client, "긴.hwpx", long_hwpx, folder_id=str(root.id))
    assert r.status_code == 201 and r.json()["truncated"]
    ldoc = await app_db.get(Document, r.json()["doc"]["id"], populate_existing=True)
    assert "(파일이 길어 여기서 끊었습니다" in (ldoc.text_cache or "")
    monkeypatch.setattr(convert, "MAX_SEED_COST", 500_000)

    # 못 보는 폴더(임원 등급)는 「없는 폴더」, 시간 초과는 422 — 둘 다 문서가 생기지 않는다
    exec_folder = Folder(ws_id=root.ws_id, parent_id=None, title="경영", min_role="exec")
    app_db.add(exec_folder)
    await app_db.commit()
    r = await _import(client, "a.docx", DOCX, folder_id=str(exec_folder.id))
    assert (r.status_code, r.json()["detail"]) == (422, "없는 폴더입니다.")
    monkeypatch.setattr(convert, "TIMEOUT_S", 0.01)

    def slow(name, data):
        time.sleep(0.3)
        return convert.Converted("<p>x</p>", False)

    monkeypatch.setattr(convert, "to_html", slow)
    r = await _import(client, "a.docx", DOCX, folder_id=str(root.id))
    assert (r.status_code, r.json()["detail"]) == (422, "파일을 읽는 데 너무 오래 걸립니다.")
    monkeypatch.setattr(convert, "to_html", _real_to_html)
    monkeypatch.setattr(convert, "TIMEOUT_S", 60.0)
    assert (
        len((await app_db.execute(select(Document))).scalars().all()) == len(before) + 3
    )  # 기획서·표·긴 + 그림

    # 그림까지 더해 하루 상한을 본다 — 지금까지 올린 수(원본 4 + 그림 1 + 실패 2) 에 원본 1 + 그림 1 을 더하면 상한 8 을 넘는다
    monkeypatch.setattr(files, "DAILY_UPLOADS", 8)
    r = await _import(client, "그림2.docx", make_rich_docx(), folder_id=str(root.id))
    assert (r.status_code, r.json()["code"]) == (429, "UPLOAD_THROTTLED") and "그림" in r.json()[
        "detail"
    ]
    assert (
        len((await app_db.execute(select(Document))).scalars().all()) == len(before) + 3
    )  # 문서도 안 생겼다

    # 실패한 변환도 하루 상한에 센다 — 위에서 형식 오류·시간 초과가 남았으니 상한 1 이면 다음은 429
    monkeypatch.setattr(files, "DAILY_UPLOADS", 1)
    r = await _import(client, "b.docx", DOCX, folder_id=str(root.id))
    assert (r.status_code, r.json()["code"]) == (429, "UPLOAD_THROTTLED")


async def test_import_pdf_route(client: AsyncClient, users: Users, app_db, minio_bucket) -> None:
    """PDF 도 같은 경로로 문서가 된다(README 67) — 글자는 본문·검색 평문에, 원본은 첨부에. 스캔본·깨진 파일은 422."""
    root = await _root(app_db)
    await app_db.commit()
    await login(client, "sujin@zenith.co.kr")
    r = await _import(client, "계약서.pdf", pdf_bytes("Hello PDF"), folder_id=str(root.id))
    assert r.status_code == 201, r.text
    doc = await app_db.get(Document, r.json()["doc"]["id"], populate_existing=True)
    assert doc.title == "계약서" and "Hello PDF" in doc.text_cache
    assert ydoc_fragment(doc.ydoc_snapshot).startswith("<paragraph>Hello PDF</paragraph>")
    r = await _import(client, "스캔.pdf", pdf_bytes(""), folder_id=str(root.id))
    assert r.status_code == 422 and "스캔본" in r.json()["detail"]
    r = await _import(client, "깨짐.pdf", b"%PDF-1.4", folder_id=str(root.id))
    assert r.status_code == 422 and "PDF" in r.json()["detail"]
