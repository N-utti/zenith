"""파일 수정 리뷰 후속 — 복잡 문단 읽기 전용, 글상자 중복 제외, 차트 xlsx 거부, 보기 글자 보존, 결과 파일 상한."""

import io
import json
import zipfile

import openpyxl
import pytest
from fastapi import FastAPI
from httpx import AsyncClient

from app.ai import edit
from app.ai.provider import get_provider
from app.routers import ai

from .conftest import Users, csrf, login
from .test_ai_attachments import _upload, xlsx_bytes
from .test_ai_edit import Editing, W


def _docx(body_xml: str) -> bytes:
    xml = f'<?xml version="1.0"?><w:document xmlns:w="{W}"><w:body>{body_xml}</w:body></w:document>'
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("word/document.xml", xml)
    return buf.getvalue()


def test_complex_paragraphs_are_read_only_and_textboxes_not_duplicated() -> None:
    data = _docx(
        "<w:p><w:r><w:t>see </w:t></w:r><w:hyperlink><w:r><w:t>LINK</w:t></w:r></w:hyperlink></w:p>"
        "<w:p><w:ins><w:r><w:t>tracked</w:t></w:r></w:ins></w:p>"
        "<w:p><w:r><w:t>outer</w:t><w:pict><w:txbxContent><w:p><w:r><w:t>inner</w:t></w:r></w:p></w:txbxContent></w:pict></w:r></w:p>"
        "<w:p><w:r><w:t>plain</w:t></w:r></w:p>"
    )
    view = edit.dump_docx(data)
    assert view.splitlines()[0].startswith("[p0] (읽기 전용") and "see LINK" in view.splitlines()[0]
    assert "[p1] (읽기 전용" in view and "[p2] (읽기 전용" in view
    assert (
        "outerinner" not in view and "[p3] inner" in view and "[p4] plain" in view
    )  # 글상자 글은 제 문단에만
    for idx in (0, 1, 2):
        with pytest.raises(edit.BadOp):
            edit.apply_docx(data, [{"paragraph": idx, "text": "x"}])
    out, changes = edit.apply_docx(
        data, [{"paragraph": 4, "text": "changed"}, {"paragraph": 3, "text": "in2"}]
    )
    assert [c.after for c in changes] == ["changed", "in2"]
    assert edit.dump_docx(out).splitlines()[-1] == "[p4] changed"
    assert "LINK" in edit.dump_docx(out)  # 링크 문단은 그대로


def test_xlsx_with_charts_is_detected() -> None:
    plain = xlsx_bytes()
    assert edit.has_unsupported_parts(plain) is False
    buf = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(plain)) as src, zipfile.ZipFile(buf, "w") as dst:
        for info in src.infolist():
            dst.writestr(info, src.read(info))
        dst.writestr("xl/charts/chart1.xml", "<c:chartSpace/>")
    assert edit.has_unsupported_parts(buf.getvalue()) is True


@pytest.mark.usefixtures("minio_bucket")
async def test_edit_view_keeps_text_and_limits(
    app: FastAPI, client: AsyncClient, users: Users, app_db, monkeypatch
) -> None:
    app.dependency_overrides[get_provider] = Editing
    ai._upload_calls.clear()
    ai._check_calls.clear()
    await login(client, "sujin@zenith.co.kr")
    wb = openpyxl.Workbook()
    wb.active["A1"] = "[3] 《보고서》 <파일>"
    buf = io.BytesIO()
    wb.save(buf)
    att = (await _upload(client, "기호.xlsx", buf.getvalue())).json()
    Editing.reply = json.dumps([{"sheet": "Sheet", "cell": "A1", "value": "[3] 《보고서》 그대로​"}])
    r = await client.post(
        f"/api/ai/attachments/{att['id']}/edit", json={"instruction": "x"}, headers=csrf(client)
    )
    assert r.status_code == 200, r.text
    sent = Editing.seen[0]["content"]
    assert "Sheet!A1 = [3] 《보고서》 <​파일>" in sent  # 보기는 태그만 무력화, 글자는 그대로
    assert r.json()["changes"][0]["after"] == "[3] 《보고서》 그대로"  # 제로폭 공백은 지운다
    # 차트 있는 엑셀 422
    buf2 = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(xlsx_bytes())) as src, zipfile.ZipFile(buf2, "w") as dst:
        for info in src.infolist():
            dst.writestr(info, src.read(info))
        dst.writestr("xl/charts/chart1.xml", "<c:chartSpace/>")
    chart = (await _upload(client, "차트.xlsx", buf2.getvalue())).json()
    r = await client.post(
        f"/api/ai/attachments/{chart['id']}/edit", json={"instruction": "x"}, headers=csrf(client)
    )
    assert r.status_code == 422 and "차트·그림" in r.json()["detail"]
    # 결과 파일도 쿼터 안
    monkeypatch.setattr(ai, "ATTACH_QUOTA_BYTES", 1)
    Editing.reply = json.dumps(
        [{"sheet": "Sheet", "cell": "A1", "value": "x"}]
    )  # 빈 [] 는 그 전에 422 가 난다
    r = await client.post(
        f"/api/ai/attachments/{att['id']}/edit", json={"instruction": "x"}, headers=csrf(client)
    )
    assert r.status_code == 422 and r.json()["detail"].startswith("첨부 보관 한도")
    ai._check_calls.clear()
