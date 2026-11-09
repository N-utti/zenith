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
    body, truncated = convert.to_html("a.docx", make_docx(DOCX_BODY, DOCX_RELS))
    assert not truncated
    assert body == (
        "<h1>제목 하나</h1><p>보통 <strong>굵게</strong><u>밑줄</u></p>"
        "<table><tr><td><p>A1</p></td><td><p>B1 &lt;x&gt;</p></td></tr></table>"
        "<p>링크</p>"  # javascript: 링크는 벗기고 글자만
    )


def test_xlsx_to_html() -> None:
    body, _ = convert.to_html("a.xlsx", make_xlsx())
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
    body, _ = convert.to_html("a.hwpx", make_hwpx(sec))
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
        convert.to_html("a.pdf", b"%PDF-1.4")
    with pytest.raises(Unsupported):
        convert.to_html("a.docx", b"PK\x03\x04 broken")  # 깨진 zip 도 500 이 아니라 Unsupported
    with pytest.raises(Unsupported):
        convert.to_html("a.hwpx", make_docx("<w:p/>"))  # 서명은 zip 인데 섹션이 없다
    with pytest.raises(Empty):
        convert.to_html("a.docx", make_docx("<w:p><w:r><w:t>  </w:t></w:r></w:p>"))


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
    body, truncated = convert.to_html("a.xlsx", make_xlsx())  # 머리글 2칸 + 다음 행 2칸 = 4 > 3
    assert truncated
    assert body == (
        "<h2>매출</h2><table><tr><th><p>이름</p></th><th><p>금액</p></th></tr></table>"
        + convert.TRUNCATED_NOTE
    )


def test_rejects_too_large_body_xml(monkeypatch) -> None:
    monkeypatch.setattr(convert, "MAX_XML_BYTES", 100)
    with pytest.raises(convert.TooLarge):
        convert.to_html("a.docx", DOCX)
    with pytest.raises(convert.TooLarge):
        convert.to_html(
            "a.hwpx", make_hwpx("<hp:p><hp:run><hp:t>" + "가" * 100 + "</hp:t></hp:run></hp:p>")
        )


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
        convert.to_html("a.xlsx", with_dimension("A1:XFD1048576"))
    # 선언이 상한 아래라도 두 칸 사이의 빈 행을 read_only 가 1024칸짜리로 돌려준다 — 도는 칸 수(MAX_XLSX_VISITED)에서 끊는다
    wb.active["AMJ5000"] = "끝"
    far = io.BytesIO()
    wb.save(far)
    body, truncated = convert.to_html("a.xlsx", far.getvalue())
    assert truncated and body.startswith("<h2>Sheet</h2><table><tr><th><p>x</p></th></tr></table>")


def test_zip_entry_count_limit() -> None:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("mimetype", "application/hwp+zip")
        for i in range(2001):
            z.writestr(f"junk/{i}", b"")
    with pytest.raises(Unsupported):
        convert.to_html("a.hwpx", buf.getvalue())


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
    body, _ = convert.to_html("a.xlsx", buf.getvalue())
    assert body == (
        "<h2>S</h2><table><tr><th><p>h</p></th><th><p></p></th><th><p></p></th></tr>"
        "<tr><td><p>x</p></td><td><p>y</p></td><td><p>z</p></td></tr></table>"
    )


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

    # 감사 기록에 문서 id, xlsx·hwpx 도 같은 경로로, 끊기면 truncated
    row_audit = (
        (await app_db.execute(select(AuditEvent).where(AuditEvent.kind == "files.uploaded")))
        .scalars()
        .one()
    )
    assert row_audit.detail["doc"] == body["doc"]["id"]
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
        return "<p>x</p>", False

    monkeypatch.setattr(convert, "to_html", slow)
    r = await _import(client, "a.docx", DOCX, folder_id=str(root.id))
    assert (r.status_code, r.json()["detail"]) == (422, "파일을 읽는 데 너무 오래 걸립니다.")
    monkeypatch.setattr(convert, "to_html", _real_to_html)
    monkeypatch.setattr(convert, "TIMEOUT_S", 60.0)
    assert len((await app_db.execute(select(Document))).scalars().all()) == len(before) + 2

    # 실패한 변환도 하루 상한에 센다 — 위에서 형식 오류·시간 초과가 남았으니 상한 1 이면 다음은 429
    monkeypatch.setattr(files, "DAILY_UPLOADS", 1)
    r = await _import(client, "b.docx", DOCX, folder_id=str(root.id))
    assert (r.status_code, r.json()["code"]) == (429, "UPLOAD_THROTTLED")
