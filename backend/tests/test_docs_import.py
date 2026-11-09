"""파일 가져오기(README 60) — app/convert.py 변환·필터·끊기, POST /docs/import 경로.

변환 단위 테스트는 라이브러리로 만든 최소 파일이다. 실제 한글·워드가 만든 파일은 실서버에서 손으로 한 번 본다.
경로 테스트는 원본을 MinIO 에 넣으므로 MinIO 가 없으면 skip(conftest.minio_bucket).
"""

import io
import re
import time
import uuid
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
    assert body == (
        "<h1>제목 하나</h1><p>보통 <strong>굵게</strong><u>밑줄</u></p>"
        "<table><tr><td><p>A1</p></td><td><p>B1 &lt;x&gt;</p></td></tr></table>"
        "<p>링크</p>"  # javascript: 링크는 벗기고 글자만
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
        th("a.pdf", b"%PDF-1.4")
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
    '<table><tr><th colspan="2"><p>머리</p></th></tr><tr><td><p style="text-align:right"><em>A</em></p></td><td><p>B</p></td></tr></table>'
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
    assert '<imageBlock src="/api/files/img1" width="200"></imageBlock><table>' in frag
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
    assert body == (
        "<h2>S</h2><table><tr><th><p><strong>머리</strong></p></th><th><p>x</p></th></tr>"
        '<tr><td><p style="text-align:center"><span style="color:#ff0000"><mark data-color="#ffff00"><em>빨강</em></mark></span></p></td>'
        "<td><p>3</p></td></tr></table>"
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
        '<table><tr><td rowspan="2"><p>A</p></td><td><p>B</p></td></tr><tr><td><p>C</p></td></tr></table>'
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
    r = await _import(client, "a.pdf", b"%PDF-1.4 x", folder_id=str(root.id))
    assert (r.status_code, r.json()["code"]) == (422, "VALIDATION") and "hwpx" in r.json()["detail"]
    r = await _import(client, "a.docx", b"", folder_id=str(root.id))
    assert r.status_code == 422
    r = await _import(client, "a.docx", DOCX, folder_id=str(uuid.uuid4()))
    assert (r.status_code, r.json()["detail"]) == (422, "없는 폴더입니다.")
    assert len((await app_db.execute(select(Document))).scalars().all()) == len(before)

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
